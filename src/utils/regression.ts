/**
 * Multilinear Regression Utility
 * Implements least squares regression: β = (X^T X)^-1 X^T Y
 */

export interface RegressionResult {
    coefficients: number[];  // [β₀, β₁, β₂, β₃, ...]
    rSquared: number;        // Coefficient of determination
    dataPoints: number;      // Number of observations used
}

export interface RegressionData {
    independent: number[][];  // X matrix (n × k)
    dependent: number[];      // Y vector (n × 1)
}

/**
 * Matrix transpose
 */
function transpose(matrix: number[][]): number[][] {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const result: number[][] = [];
    
    for (let j = 0; j < cols; j++) {
        result[j] = [];
        for (let i = 0; i < rows; i++) {
            result[j][i] = matrix[i][j];
        }
    }
    
    return result;
}

/**
 * Matrix multiplication
 */
function multiply(a: number[][], b: number[][]): number[][] {
    const aRows = a.length;
    const aCols = a[0].length;
    const bCols = b[0].length;
    const result: number[][] = [];
    
    for (let i = 0; i < aRows; i++) {
        result[i] = [];
        for (let j = 0; j < bCols; j++) {
            let sum = 0;
            for (let k = 0; k < aCols; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }
    
    return result;
}

/**
 * Matrix-vector multiplication
 */
function multiplyVector(matrix: number[][], vector: number[]): number[] {
    const rows = matrix.length;
    const result: number[] = [];
    
    for (let i = 0; i < rows; i++) {
        let sum = 0;
        for (let j = 0; j < matrix[i].length; j++) {
            sum += matrix[i][j] * vector[j];
        }
        result[i] = sum;
    }
    
    return result;
}

/**
 * Matrix inverse using Gauss-Jordan elimination
 */
function inverse(matrix: number[][]): number[][] | null {
    const n = matrix.length;
    
    // Create augmented matrix [A | I]
    const augmented: number[][] = [];
    for (let i = 0; i < n; i++) {
        augmented[i] = [...matrix[i]];
        for (let j = 0; j < n; j++) {
            augmented[i].push(i === j ? 1 : 0);
        }
    }
    
    // Forward elimination
    for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
                maxRow = k;
            }
        }
        
        // Swap rows
        [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
        
        // Check for singular matrix
        if (Math.abs(augmented[i][i]) < 1e-10) {
            return null;
        }
        
        // Scale pivot row
        const pivot = augmented[i][i];
        for (let j = 0; j < 2 * n; j++) {
            augmented[i][j] /= pivot;
        }
        
        // Eliminate column
        for (let k = 0; k < n; k++) {
            if (k !== i) {
                const factor = augmented[k][i];
                for (let j = 0; j < 2 * n; j++) {
                    augmented[k][j] -= factor * augmented[i][j];
                }
            }
        }
    }
    
    // Extract inverse from augmented matrix
    const result: number[][] = [];
    for (let i = 0; i < n; i++) {
        result[i] = augmented[i].slice(n);
    }
    
    return result;
}

/**
 * Calculate R-squared (coefficient of determination)
 */
function calculateRSquared(
    actual: number[],
    predicted: number[]
): number {
    const n = actual.length;
    const mean = actual.reduce((sum, val) => sum + val, 0) / n;
    
    let ssTotal = 0;
    let ssResidual = 0;
    
    for (let i = 0; i < n; i++) {
        ssTotal += Math.pow(actual[i] - mean, 2);
        ssResidual += Math.pow(actual[i] - predicted[i], 2);
    }
    
    return 1 - (ssResidual / ssTotal);
}

/**
 * Perform multilinear regression
 *
 * @param data - Regression data with independent and dependent variables
 * @returns Regression coefficients and statistics
 * @throws Error if matrix is singular or data is insufficient
 */
export function performRegression(data: RegressionData): RegressionResult {
    const { independent, dependent } = data;
    const n = independent.length;
    const k = independent[0].length;
    
    // Validate input
    if (n < k + 1) {
        throw new Error(`Insufficient data points: need at least ${k + 1}, got ${n}`);
    }
    
    if (dependent.length !== n) {
        throw new Error('Mismatch between independent and dependent variable lengths');
    }
    
    // Check for NaN or Infinity in input data
    for (let i = 0; i < n; i++) {
        if (!isFinite(dependent[i])) {
            throw new Error(`Invalid dependent variable at index ${i}: ${dependent[i]}`);
        }
        for (let j = 0; j < k; j++) {
            if (!isFinite(independent[i][j])) {
                throw new Error(`Invalid independent variable at index ${i},${j}: ${independent[i][j]}`);
            }
        }
    }
    
    // Add intercept column (all 1s) to X
    const X: number[][] = [];
    for (let i = 0; i < n; i++) {
        X[i] = [1, ...independent[i]];
    }
    
    // Calculate X^T
    const XT = transpose(X);
    
    // Calculate X^T X
    const XTX = multiply(XT, X);
    
    // Check for very small determinant (near-singular matrix)
    // This can happen when variables have very little variation
    const det = calculateDeterminant(XTX);
    if (Math.abs(det) < 1e-10) {
        throw new Error(`Matrix is nearly singular (det=${det.toExponential(2)}). Data may have insufficient variation.`);
    }
    
    // Calculate (X^T X)^-1
    const XTXInv = inverse(XTX);
    if (!XTXInv) {
        throw new Error('Singular matrix: cannot compute regression coefficients');
    }
    
    // Calculate X^T Y
    const XTY = multiplyVector(XT, dependent);
    
    // Calculate β = (X^T X)^-1 X^T Y
    const coefficients = multiplyVector(XTXInv, XTY);
    
    // Check for NaN or Infinity in coefficients
    if (coefficients.some(c => !isFinite(c))) {
        throw new Error('Regression produced invalid coefficients (NaN or Infinity)');
    }
    
    // Calculate predicted values
    const predicted: number[] = [];
    for (let i = 0; i < n; i++) {
        let sum = coefficients[0]; // intercept
        for (let j = 0; j < k; j++) {
            sum += coefficients[j + 1] * independent[i][j];
        }
        predicted[i] = sum;
    }
    
    // Calculate R-squared
    const rSquared = calculateRSquared(dependent, predicted);
    
    if (!isFinite(rSquared)) {
        throw new Error('R-squared calculation produced invalid result');
    }
    
    return {
        coefficients,
        rSquared,
        dataPoints: n,
    };
}

/**
 * Calculate determinant of a matrix (for small matrices)
 * Used to check if matrix is singular
 */
function calculateDeterminant(matrix: number[][]): number {
    const n = matrix.length;
    
    if (n === 1) {
        return matrix[0][0];
    }
    
    if (n === 2) {
        return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
    }
    
    // For larger matrices, use a simple recursive method
    // (Not efficient for large matrices, but fine for our 4x4 case)
    let det = 0;
    for (let j = 0; j < n; j++) {
        const minor: number[][] = [];
        for (let i = 1; i < n; i++) {
            minor[i - 1] = [];
            for (let k = 0; k < n; k++) {
                if (k !== j) {
                    minor[i - 1].push(matrix[i][k]);
                }
            }
        }
        det += Math.pow(-1, j) * matrix[0][j] * calculateDeterminant(minor);
    }
    
    return det;
}

/**
 * Predict value using regression coefficients
 * 
 * @param coefficients - Regression coefficients [β₀, β₁, β₂, ...]
 * @param values - Independent variable values [x₁, x₂, ...]
 * @returns Predicted value
 */
export function predict(coefficients: number[], values: number[]): number {
    if (coefficients.length !== values.length + 1) {
        throw new Error('Coefficient count must be one more than value count');
    }
    
    let result = coefficients[0]; // intercept
    for (let i = 0; i < values.length; i++) {
        result += coefficients[i + 1] * values[i];
    }
    
    return result;
}

// Made with Bob

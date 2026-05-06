import express, { Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import accountRoutes from './routes/account.routes';
import billsRoutes from './routes/bills.routes';
import insightsRoutes from './routes/insights.routes';
import ocrRoutes from './routes/ocr.routes';
import predictionRoutes from './routes/prediction.routes';
import userDataRoutes from './routes/user-data.routes';
import chatRoutes from './routes/chat.routes';
import tipsRoutes from './routes/tips.routes';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/accounts', accountRoutes);
app.use('/api/bills', billsRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/prediction', predictionRoutes);
app.use('/api/user-data', userDataRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tips', tipsRoutes);

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Eely Backend Server is running');
});

app.listen(port, () => {
    console.log(`[server]: Server is running at http://localhost:${port}`);
});

import * as admin from 'firebase-admin';

interface BillRecord {
    account_id: string;
    account_number: string;
    account_name: string;
    service_address: string;
    start_date: admin.firestore.Timestamp;
    end_date: admin.firestore.Timestamp;
    due_date: admin.firestore.Timestamp;
    previous_reading: number;
    current_reading: number;
    total_kwh_used: number;
    total_amount_due: number;
    rate_per_kwh: number;
    generation: number;
    transmission: number;
    system_loss: number;
    distribution: number;
    government_taxes: number;
    universal_charges: number;
    fit_all: number;
    gea_all: number;
    lifeline_subsidy: number;
    senior_citizen_subsidy: number;
    other_charges: number;
    avg_temperature: number | null;
    avg_humidity: number | null;
    coal_price: number | null;
    coal_price_unit?: string;
    coal_price_month?: string;
    coal_price_year?: number;
    coal_price_source?: string;
}

export interface ExtractedBillData {
    account_number: string;
    account_name: string;
    service_address: string;
    start_date: string;
    end_date: string;
    due_date: string;
    previous_reading: number;
    current_reading: number;
    total_kwh_used: number;
    total_amount_due: number;
    rate_per_kwh: number;
    generation: number;
    transmission: number;
    system_loss: number;
    distribution: number;
    government_taxes: number;
    universal_charges: number;
    fit_all: number;
    gea_all: number;
    lifeline_subsidy: number;
    senior_citizen_subsidy: number;
    other_charges: number;
}

export interface CreateBillRequestBody {
    uid: string;
    bill: ExtractedBillData;
}

export default BillRecord;

import { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { db } from '../config/firebase';
import BillRecord, { CreateBillRequestBody, ExtractedBillData } from '../models/bill.model';
import { invalidateTipsCache } from '../services/tips.service';

const requiredFields: Array<keyof ExtractedBillData> = [
    'account_number',
    'account_name',
    'service_address',
    'start_date',
    'end_date',
    'due_date',
    'previous_reading',
    'current_reading',
    'total_kwh_used',
    'total_amount_due',
    'rate_per_kwh',
    'generation',
    'transmission',
    'system_loss',
    'distribution',
    'government_taxes',
    'universal_charges',
    'fit_all',
    'gea_all',
    'lifeline_subsidy',
    'senior_citizen_subsidy',
    'other_charges',
];

function isValidNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFirestoreTimestamp(value: unknown): value is admin.firestore.Timestamp {
    return (
        typeof value === 'object' &&
        value !== null &&
        'toDate' in value &&
        typeof (value as admin.firestore.Timestamp).toDate === 'function'
    );
}

function parseBillDate(value: string, fieldName: string): admin.firestore.Timestamp {
    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
        throw new Error(`Invalid ${fieldName}; expected an ISO 8601 date string`);
    }

    return admin.firestore.Timestamp.fromDate(parsedDate);
}

export const createBill = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid, bill } = req.body as Partial<CreateBillRequestBody>;

        if (!isValidNonEmptyString(uid)) {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        if (!bill || typeof bill !== 'object') {
            res.status(400).json({ error: 'Missing or invalid required field: bill' });
            return;
        }

        for (const field of requiredFields) {
            const value = bill[field];

            if (field === 'start_date' || field === 'end_date' || field === 'due_date') {
                if (!isValidNonEmptyString(value)) {
                    res.status(400).json({ error: `Missing or invalid required field: bill.${field}` });
                    return;
                }
                continue;
            }

            if (field === 'account_number' || field === 'account_name' || field === 'service_address') {
                if (!isValidNonEmptyString(value)) {
                    res.status(400).json({ error: `Missing or invalid required field: bill.${field}` });
                    return;
                }
                continue;
            }

            if (typeof value === 'string') {
                if (value.trim().length === 0) {
                    res.status(400).json({ error: `Missing or invalid required field: bill.${field}` });
                    return;
                }

                const numericValue = Number(value);
                if (!Number.isFinite(numericValue)) {
                    res.status(400).json({ error: `Missing or invalid required field: bill.${field}` });
                    return;
                }
                continue;
            }

            if (!isValidNumber(value)) {
                res.status(400).json({ error: `Missing or invalid required field: bill.${field}` });
                return;
            }
        }

        const normalizedBill: BillRecord = {
            account_id: uid,
            account_number: bill.account_number,
            account_name: bill.account_name,
            service_address: bill.service_address,
            start_date: parseBillDate(bill.start_date, 'bill.start_date'),
            end_date: parseBillDate(bill.end_date, 'bill.end_date'),
            due_date: parseBillDate(bill.due_date, 'bill.due_date'),
            previous_reading: Number(bill.previous_reading),
            current_reading: Number(bill.current_reading),
            total_kwh_used: Number(bill.total_kwh_used),
            total_amount_due: Number(bill.total_amount_due),
            rate_per_kwh: Number(bill.rate_per_kwh),
            generation: Number(bill.generation),
            transmission: Number(bill.transmission),
            system_loss: Number(bill.system_loss),
            distribution: Number(bill.distribution),
            government_taxes: Number(bill.government_taxes),
            universal_charges: Number(bill.universal_charges),
            fit_all: Number(bill.fit_all),
            gea_all: Number(bill.gea_all),
            lifeline_subsidy: Number(bill.lifeline_subsidy),
            senior_citizen_subsidy: Number(bill.senior_citizen_subsidy),
            other_charges: Number(bill.other_charges),
            avg_temperature: null,
            avg_humidity: null,
            coal_price: null,
        };

        const docRef = await db.collection('bills').add(normalizedBill);

        // Invalidate tips cache so they regenerate with the new bill context
        await invalidateTipsCache(uid);

        res.status(201).json({
            message: 'Bill stored successfully',
            id: docRef.id,
            data: normalizedBill,
        });
    } catch (error) {
        console.error('Error storing bill document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteBill = async (req: Request, res: Response): Promise<void> => {
    try {
        const { docId } = req.params;
        const uidFromBody = (req.body as { uid?: unknown } | undefined)?.uid;
        const uidFromQuery = req.query?.uid;
        const uid = typeof uidFromBody === 'string'
            ? uidFromBody
            : typeof uidFromQuery === 'string'
                ? uidFromQuery
                : undefined;

        if (!isValidNonEmptyString(docId)) {
            res.status(400).json({ error: 'Missing or invalid required field: docId' });
            return;
        }

        if (!isValidNonEmptyString(uid)) {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const docRef = db.collection('bills').doc(docId);
        const snapshot = await docRef.get();

        if (!snapshot.exists) {
            res.status(404).json({ error: 'Bill not found' });
            return;
        }

        const data = snapshot.data();
        if (!data || data.account_id !== uid) {
            res.status(403).json({ error: 'You are not authorized to delete this bill' });
            return;
        }

        await docRef.delete();

        res.status(200).json({
            message: 'Bill deleted successfully',
            id: docId,
        });
    } catch (error) {
        console.error('Error deleting bill document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getBillsByUid = async (req: Request, res: Response): Promise<void> => {
    try {
        const { uid } = req.params;

        if (!uid || typeof uid !== 'string') {
            res.status(400).json({ error: 'Missing or invalid required field: uid' });
            return;
        }

        const snapshot = await db
            .collection('bills')
            .where('account_id', '==', uid)
            .get();

        const bills = snapshot.docs
            .map((doc) => {
                const data = doc.data();
                const serializedBill: Record<string, unknown> = { _doc_id: doc.id };

                for (const [key, value] of Object.entries(data)) {
                    serializedBill[key] = isFirestoreTimestamp(value) ? value.toDate().toISOString() : value;
                }

                return serializedBill;
            })
            .sort((left, right) => {
                const leftDate = typeof left.due_date === 'string' ? Date.parse(left.due_date) : 0;
                const rightDate = typeof right.due_date === 'string' ? Date.parse(right.due_date) : 0;

                return rightDate - leftDate;
            });

        res.status(200).json({
            data: bills,
        });
    } catch (error) {
        console.error('Error fetching bills by uid:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const enrichBill = async (req: Request, res: Response): Promise<void> => {
    try {
        const { billId } = req.params;
        const { latitude, longitude } = req.body;

        if (!isValidNonEmptyString(billId)) {
            res.status(400).json({ error: 'Missing or invalid required field: billId' });
            return;
        }

        // Fetch bill to get dates
        const billDoc = await db.collection('bills').doc(billId).get();

        if (!billDoc.exists) {
            res.status(404).json({ error: 'Bill not found' });
            return;
        }

        const billData = billDoc.data();
        if (!billData) {
            res.status(404).json({ error: 'Bill data not found' });
            return;
        }

        // Convert Firestore timestamps to YYYY-MM-DD format
        const startDate = billData.start_date.toDate().toISOString().split('T')[0];
        const endDate = billData.end_date.toDate().toISOString().split('T')[0];

        console.log(`\n[Enrichment] Starting enrichment for bill ${billId}`);
        console.log(`[Enrichment] Period: ${startDate} to ${endDate}`);

        // Import and call enrichment service
        const { enrichBillData } = await import('../services/bill-enrichment.service');
        await enrichBillData(billId, startDate, endDate, latitude, longitude);

        // Fetch updated bill to get enrichment data
        const updatedBillDoc = await db.collection('bills').doc(billId).get();
        const updatedBillData = updatedBillDoc.data();

        console.log(`\n[Enrichment] ✅ Enrichment completed successfully!`);
        console.log(`[Enrichment] 🌡️  Average Temperature: ${updatedBillData?.avg_temperature}°C`);
        console.log(`[Enrichment] 💧 Average Humidity: ${updatedBillData?.avg_humidity}%`);
        console.log(`[Enrichment] ⛏️  Coal Price: $${updatedBillData?.coal_price} ${updatedBillData?.coal_price_unit}`);
        console.log(`[Enrichment] 📅 Coal Price Period: ${updatedBillData?.coal_price_month} ${updatedBillData?.coal_price_year}`);
        console.log(`[Enrichment] 🔗 Source: ${updatedBillData?.coal_price_source}\n`);

        res.status(200).json({
            message: 'Bill enriched successfully',
            billId,
            enrichmentData: {
                avg_temperature: updatedBillData?.avg_temperature,
                avg_humidity: updatedBillData?.avg_humidity,
                coal_price: updatedBillData?.coal_price,
                coal_price_unit: updatedBillData?.coal_price_unit,
                coal_price_month: updatedBillData?.coal_price_month,
                coal_price_year: updatedBillData?.coal_price_year,
                coal_price_source: updatedBillData?.coal_price_source,
            },
        });
    } catch (error) {
        console.error('[Enrichment] ❌ Error enriching bill:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to enrich bill';
        res.status(500).json({ error: errorMessage });
    }
};

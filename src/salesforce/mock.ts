// Sample cases for SF_MODE=mock (demo and screen building). Invented; matches the demo properties.
import type { CaseInfo } from './client';

export const MOCK_CASES: Record<string, CaseInfo> = {
  '00812345': { caseNumber: '00812345', status: 'Work Scheduled', subject: 'Units not reading on October bills', accountName: 'Maple Ridge Apartments', accountId: '001MOCK0000001', lastModified: '2026-11-04T15:00:00Z',
    workOrders: [{ number: '00045678', status: 'Completed', startDate: '2026-11-05T08:00:00Z' }] },
  '00812999': { caseNumber: '00812999', status: 'In Progress', subject: 'Two units not transmitting', accountName: 'Harbor View Lofts', accountId: '001MOCK0000002', lastModified: '2026-11-10T17:30:00Z',
    workOrders: [{ number: '00045702', status: 'Completed', startDate: '2026-11-10T09:00:00Z' }] },
  '00813050': { caseNumber: '00813050', status: 'Awaiting Authorization', subject: 'High bill dispute, unit 104', accountName: 'Maple Ridge Apartments', accountId: '001MOCK0000001', lastModified: '2026-11-12T14:10:00Z', workOrders: [] },
  '00813077': { caseNumber: '00813077', status: 'Authorized', subject: 'MSA quarterly service', accountName: 'Cedar Court', accountId: '001MOCK0000003', lastModified: '2026-11-08T10:00:00Z',
    workOrders: [{ number: '00045720', status: 'Scheduled', startDate: '2026-11-18T08:00:00Z' }] },
};

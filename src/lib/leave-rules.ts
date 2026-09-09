import { db } from '@/db/client';
import { leaveRequests, leaveBalances } from '@/db/schema';
import { and, eq, inArray, ne } from 'drizzle-orm';

export function parseDateOnly(value: string): Date | null {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function countInclusiveDays(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) throw new Error('Invalid date');
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function validateDateRange(startDate: string, endDate: string): string | null {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return 'Start and end dates must be valid calendar dates.';
  if (end.getTime() < start.getTime()) return 'End date cannot be before the start date.';
  return null;
}

/**
 * Returns true if the given range overlaps any existing pending or approved
 * leave request for this employee (excluding a specific request id, used
 * when re-checking on approval).
 */
export async function hasOverlappingLeave(
  employeeId: string,
  startDate: string,
  endDate: string,
  excludeRequestId?: string
): Promise<boolean> {
  const existing = await db
    .select({
      id: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        excludeRequestId ? ne(leaveRequests.id, excludeRequestId) : undefined
      )
    );

  const newStart = parseDateOnly(startDate)!.getTime();
  const newEnd = parseDateOnly(endDate)!.getTime();

  return existing.some((row) => {
    const existingStart = parseDateOnly(row.startDate)!.getTime();
    const existingEnd = parseDateOnly(row.endDate)!.getTime();
    return newStart <= existingEnd && existingStart <= newEnd;
  });
}

/**
 * Returns the employee's remaining balance for a leave type in the given year,
 * or null if no balance record exists (treated as zero allowance).
 */
export async function getRemainingBalance(
  employeeId: string,
  leaveTypeId: string,
  year: number
): Promise<{ allocated: number; used: number; remaining: number } | null> {
  const rows = await db
    .select()
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { allocated: row.allocated, used: row.used, remaining: row.allocated - row.used };
}

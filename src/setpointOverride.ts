export interface SetpointOverrideStatus {
  value: number | null
  last_error: string | null
  request_id: string | null
}

export function isSetpointOverrideFresh(
  status: SetpointOverrideStatus | null | undefined,
  observedAt: number | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!status || !(status.value === null || (Number.isInteger(status.value)
    && status.value >= -2147483648 && status.value <= 2147483647))) return false
  if (!(status.last_error === null || typeof status.last_error === 'string')
    || !(status.request_id === null || typeof status.request_id === 'string')) return false
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt)) return false
  const age = nowMs / 1000 - observedAt
  return age >= 0 && age <= 30
}

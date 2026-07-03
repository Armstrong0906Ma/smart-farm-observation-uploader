import { NextResponse } from 'next/server';

export function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(error) {
  const status = error.status || 500;
  return json({ error: error.message || 'Server error' }, status);
}

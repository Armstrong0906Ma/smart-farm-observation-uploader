import { pollAutoCaptureSource } from '@/lib/autoCapture';
import { errorResponse, json } from '@/lib/http';
import { requireInternalToken } from '@/lib/internalAuth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    requireInternalToken(request);
    return json(await pollAutoCaptureSource());
  } catch (error) {
    return errorResponse(error);
  }
}

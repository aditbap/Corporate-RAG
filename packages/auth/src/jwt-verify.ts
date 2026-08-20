import { createClient } from '@supabase/supabase-js';

export interface VerificationResult {
  userId: string;
  email?: string;
  orgId?: string;
  role?: string;
  isValid: boolean;
  error?: string;
}

/**
 * Verify a Supabase JWT token using the Supabase API
 */
export async function verifyJwt(token: string): Promise<VerificationResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    return { userId: '', isValid: false, error: 'Supabase env vars not configured' };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      throw error || new Error('User not found');
    }
    
    return {
      userId: user.id,
      email: user.email,
      orgId: user.app_metadata?.org_id || user.user_metadata?.org_id,
      role: user.app_metadata?.role || user.user_metadata?.role,
      isValid: true,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Invalid token';
    console.error('JWT Verification Failed:', errorMsg);
    return {
      userId: '',
      isValid: false,
      error: errorMsg,
    };
  }
}

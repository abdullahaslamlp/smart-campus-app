import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://spmjuieierhsgjtzznoo.supabase.co';
const supabaseAnonKey = 'sb_publishable_XcWpoXjiApzdvqpkHbE6gA_IAwAmaZw'

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
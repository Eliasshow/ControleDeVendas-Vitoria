import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kekudywfeexhzlmmxslz.supabase.co'
const supabaseAnonKey = 'sb_publishable_wLX2k7XUmO-z6UOcDYy2vg_R1ez0phL'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
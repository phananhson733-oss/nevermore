// @input  — @supabase/supabase-js、环境变量 NEXT_PUBLIC_SUPABASE_*
// @output — getSupabase() 惰性初始化客户端
// @pos    — 数据层入口，供所有需要数据库访问的模块使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  _supabase = createClient(supabaseUrl, supabaseAnonKey);
  return _supabase;
}

// Backward-compatible alias
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return Reflect.get(getSupabase(), prop);
  },
});

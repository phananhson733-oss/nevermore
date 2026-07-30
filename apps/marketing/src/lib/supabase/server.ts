// @input  — @supabase/ssr、next/headers、环境变量 NEXT_PUBLIC_SUPABASE_*
// @output — createServerSupabaseClient() 服务端 Supabase 客户端
// @pos    — Auth 层，Server Components / Route Handlers 使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component 中 setAll 会抛错，可忽略
          }
        },
      },
    },
  );
}

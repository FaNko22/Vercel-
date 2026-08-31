import { createClient } from "@supabase/supabase-js";

// القيم دي بتتقرا من متغيرات البيئة (environment variables) مش مكتوبة هنا مباشرة.
// اعمل نسخة من .env.example باسم .env.local وحط فيها القيم الحقيقية بتاعتك
// (تلاقيها في Supabase Dashboard > Settings > API)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "لازم تحط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.local (شوف .env.example)"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

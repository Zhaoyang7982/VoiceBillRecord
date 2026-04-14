-- VoiceBillRecord — Neon Postgres 初始化（在 Neon SQL 编辑器执行）
-- categories + expenses；分类与 /api/parse、/api/expenses 枚举一致（含「通讯」）

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric NOT NULL,
  shop text,
  category text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  note text
);

INSERT INTO categories (name)
VALUES
  ('餐饮'),
  ('交通'),
  ('购物'),
  ('娱乐'),
  ('医疗'),
  ('住房'),
  ('通讯'),
  ('其他')
ON CONFLICT (name) DO NOTHING;

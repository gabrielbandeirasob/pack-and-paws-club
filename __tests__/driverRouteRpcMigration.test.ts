import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/202609240026_driver_otimiza_rota.sql'),
  'utf8',
);

function functionBody(name: string): string {
  const body = migration.match(
    new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`, 'i'),
  )?.[0];
  expect(body).toBeDefined();
  return body!;
}

describe('driver_reorder_route_stops migration', () => {
  it('drops the old defaulted signature before recreating it without a default', () => {
    const drop = migration.indexOf('drop function if exists public.driver_reorder_route_stops(uuid, uuid[], integer);');
    const create = migration.indexOf('create or replace function public.driver_reorder_route_stops(');
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThan(create);
  });

  it('requires an expected route version and explicitly rejects NULL', () => {
    const body = functionBody('driver_reorder_route_stops');
    expect(body).toMatch(/p_esperado integer\s*\n\)/);
    expect(body).not.toMatch(/p_esperado integer default null/);
    expect(body).toMatch(/if p_esperado is null then[\s\S]*raise exception 'expected route version is required'/i);
  });

  it('locks the route row before reading and validating lock_version', () => {
    const body = functionBody('driver_reorder_route_stops');
    const rowRead = body.match(
      /select driver_id, status::text, lock_version[\s\S]*?where id = p_route_id[\s\S]*?;/i,
    )?.[0];

    expect(rowRead).toBeDefined();
    expect(rowRead).toMatch(/for update\s*;/i);
    expect(body.indexOf('for update;')).toBeLessThan(body.indexOf("raise exception 'stale_route'"));
  });

  it.each(['reorder_route_stops', 'assign_stop_to_route', 'publish_route'])(
    'serializes manager writer %s with the same route-row lock',
    (name) => {
      const body = functionBody(name);
      expect(body).toMatch(/from public\.routes[\s\S]*?where id = p_route_id[\s\S]*?for update\s*;/i);
      expect(body.indexOf('for update;')).toBeLessThan(body.indexOf("raise exception 'stale_route'"));
    },
  );
});

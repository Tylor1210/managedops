import { json, dropRequiresApproval, type Env } from "./_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [creators, clients] = await Promise.all([
    env.DB.prepare(`SELECT id, name, email, is_admin AS isAdmin FROM creators ORDER BY name`).all(),
    env.DB.prepare(`SELECT id, name FROM clients ORDER BY name`).all(),
  ]);

  return json({
    creators: creators.results,
    clients: clients.results,
    config: { dropRequiresApproval: dropRequiresApproval(env) },
  });
};

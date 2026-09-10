import { sql } from 'drizzle-orm';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(){
  // Viva has no database persistence. The preview host optionally checks its provisioned DB.
  if(!process.env.DATABASE_URL)return Response.json({ok:true,storage:'sessionStorage'});
  try{const {db}=await import('@/db');await db.execute(sql`select 1`);return Response.json({ok:true,storage:'sessionStorage',platformDatabase:'reachable'});}catch{return Response.json({ok:false},{status:503});}
}

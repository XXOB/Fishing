import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const ALLOWED_ORIGINS=[
  "https://www.petriklar.com",
  "https://petriklar.com",
  "https://xxob.github.io",
];

function corsHeaders(req:Request){
  const origin=req.headers.get("origin")||"";
  const local=/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  const allowed=local||ALLOWED_ORIGINS.some(entry=>origin===entry||origin.startsWith(entry+"/"));
  return {
    "Access-Control-Allow-Origin":allowed?origin:"https://www.petriklar.com",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
  };
}

function json(req:Request,body:Record<string,unknown>,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...corsHeaders(req),"Content-Type":"application/json; charset=utf-8"},
  });
}

function projectKey(jsonName:string,legacyName:string){
  const raw=Deno.env.get(jsonName)||"";
  if(raw){
    try{
      const keys=JSON.parse(raw) as Record<string,string>;
      const first=keys.default||Object.values(keys)[0];
      if(first) return first;
    }catch(error){ console.error(`Ungültiges ${jsonName}`,error); }
  }
  return Deno.env.get(legacyName)||"";
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders(req)});
  if(req.method!=="POST") return json(req,{deleted:false,error:"Method not allowed"},405);

  try{
    const body=await req.json().catch(()=>({}));
    if(body.confirm!=="LÖSCHEN") return json(req,{deleted:false,error:"Bestätigung fehlt"},400);

    const authHeader=req.headers.get("Authorization")||"";
    const token=authHeader.replace(/^Bearer\s+/i,"").trim();
    if(!token) return json(req,{deleted:false,error:"Nicht angemeldet"},401);

    const url=Deno.env.get("SUPABASE_URL")||"";
    const anonKey=projectKey("SUPABASE_PUBLISHABLE_KEYS","SUPABASE_ANON_KEY");
    const serviceKey=projectKey("SUPABASE_SECRET_KEYS","SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!anonKey||!serviceKey) throw new Error("Supabase-Serverkonfiguration fehlt");

    const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await authClient.auth.getUser(token);
    const user=userData.user;
    if(userError||!user) return json(req,{deleted:false,error:"Anmeldung ungültig oder abgelaufen"},401);

    const recipient=user.email||"";
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error:deleteError}=await admin.auth.admin.deleteUser(user.id);
    if(deleteError) return json(req,{deleted:false,error:"Konto konnte nicht gelöscht werden"},500);

    let emailSent=false;
    if(recipient){
      try{
        const host=Deno.env.get("SMTP_HOST")||"";
        const port=Number(Deno.env.get("SMTP_PORT")||"465");
        const username=Deno.env.get("SMTP_USER")||"";
        const password=Deno.env.get("SMTP_PASS")||"";
        const from=Deno.env.get("SMTP_FROM")||username;
        const fromName=Deno.env.get("SMTP_FROM_NAME")||"PetriKlar";
        if(!host||!username||!password||!from) throw new Error("SMTP-Konfiguration fehlt");

        const transporter=nodemailer.createTransport({
          host,
          port,
          secure:port===465,
          requireTLS:port!==465,
          auth:{user:username,pass:password},
        });
        await transporter.sendMail({
          from:`${fromName} <${from}>`,
          to:recipient,
          subject:"Dein PetriKlar-Konto wurde gelöscht",
          text:[
            "Hallo,",
            "",
            "dein PetriKlar-Konto und die damit verbundenen persönlichen App-Daten wurden erfolgreich gelöscht.",
            "",
            "Schade, dass du gehst. Danke, dass du PetriKlar ausprobiert hast. Wenn du uns sagen möchtest, was wir verbessern können, erreichst du uns unter info@petriklar.com.",
            "",
            "Du musst nichts weiter tun. Diese Nachricht dient nur als Bestätigung.",
            "",
            "Petri Heil",
            "Dein PetriKlar-Team",
            "",
            "https://www.petriklar.com",
            "Datenschutz: datenschutz@petriklar.com",
          ].join("\n"),
          html:`<p>Hallo,</p><p>dein PetriKlar-Konto und die damit verbundenen persönlichen App-Daten wurden erfolgreich gelöscht.</p><p><strong>Schade, dass du gehst.</strong> Danke, dass du PetriKlar ausprobiert hast. Wenn du uns sagen möchtest, was wir verbessern können, erreichst du uns unter <a href="mailto:info@petriklar.com">info@petriklar.com</a>.</p><p>Du musst nichts weiter tun. Diese Nachricht dient nur als Bestätigung.</p><p>Petri Heil<br>Dein PetriKlar-Team</p><p><a href="https://www.petriklar.com">www.petriklar.com</a><br><a href="mailto:datenschutz@petriklar.com">datenschutz@petriklar.com</a></p>`,
        });
        emailSent=true;
      }catch(error){
        console.error("Konto gelöscht, Bestätigungs-E-Mail fehlgeschlagen",error);
      }
    }

    return json(req,{deleted:true,emailSent});
  }catch(error){
    console.error("delete-account",error);
    return json(req,{deleted:false,error:"Interner Fehler bei der Kontolöschung"},500);
  }
});

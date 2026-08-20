"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const publicPages=[
  ["index.html","https://www.petriklar.com/"],
  ["installieren.html","https://www.petriklar.com/installieren.html"],
  ["ratgeber/index.html","https://www.petriklar.com/ratgeber/"],
  ["ratgeber/angel-app-digitales-fangbuch.html","https://www.petriklar.com/ratgeber/angel-app-digitales-fangbuch.html"],
  ["ratgeber/beissverhalten-der-fische.html","https://www.petriklar.com/ratgeber/beissverhalten-der-fische.html"]
];
const matchOne=(html,pattern,label)=>{
  const matches=[...html.matchAll(new RegExp(pattern.source,pattern.flags.includes("g")?pattern.flags:`${pattern.flags}g`))];
  assert.equal(matches.length,1,label);
  return matches[0][1]||matches[0][0];
};
const jsonLd=html=>[...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
const schemas=value=>{
  const values=Array.isArray(value)?value:[value];
  return values.flatMap(item=>item&&Array.isArray(item["@graph"])?item["@graph"]:item);
};

test("indexierbare Seiten haben eindeutige SEO-Grunddaten",()=>{
  const titles=[];
  const descriptions=[];
  const canonicals=[];
  for(const [file,expectedCanonical] of publicPages){
    const html=read(file);
    const title=matchOne(html,/<title>([^<]+)<\/title>/i,`${file}: genau ein Titel`);
    const description=matchOne(html,/<meta name="description" content="([^"]+)"\s*\/?>/i,`${file}: genau eine Beschreibung`);
    const canonical=matchOne(html,/<link rel="canonical" href="([^"]+)"\s*\/?>/i,`${file}: genau eine Canonical-URL`);
    matchOne(html,/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i,`${file}: genau eine H1`);
    assert.match(html,/<meta name="robots" content="index,follow,[^"]*max-image-preview:large/i,`${file}: Vorschauen erlaubt`);
    assert.equal(canonical,expectedCanonical,`${file}: Canonical stimmt`);
    assert.ok(title.length>=35&&title.length<=75,`${file}: sinnvoller Titelumfang`);
    assert.ok(description.length>=100&&description.length<=180,`${file}: sinnvolle Beschreibungslaenge`);
    assert.doesNotThrow(()=>jsonLd(html),`${file}: valides JSON-LD`);
    titles.push(title);
    descriptions.push(description);
    canonicals.push(canonical);
  }
  assert.equal(new Set(titles).size,titles.length,"Titel sind eindeutig");
  assert.equal(new Set(descriptions).size,descriptions.length,"Beschreibungen sind eindeutig");
  assert.equal(new Set(canonicals).size,canonicals.length,"Canonicals sind eindeutig");
});

test("Startseite beschreibt die Angel-App sichtbar und strukturiert konsistent",()=>{
  const html=read("index.html");
  const visible=html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"");
  assert.match(visible,/<h1>[\s\S]*Angel-App/i);
  assert.match(visible,/Angel-App kostenlos starten/i);
  assert.match(visible,/Kostenlos im Browser/i);
  assert.match(visible,/href="ratgeber\/"/);
  assert.match(visible,/href="installieren\.html"/);
  const nodes=jsonLd(html).flatMap(schemas);
  const website=nodes.find(node=>node["@type"]==="WebSite");
  const app=nodes.find(node=>node["@type"]==="WebApplication");
  assert.equal(website.url,"https://www.petriklar.com/");
  assert.equal(app.offers.price,"0");
  assert.equal(app.offers.priceCurrency,"EUR");
  assert.match(app.description,/Angel-App/i);
  assert.ok(app.featureList.includes("Digitales Fangbuch"));
});

test("Ratgeber-Artikel liefern vollständige Article- und Breadcrumb-Daten",()=>{
  for(const file of ["ratgeber/angel-app-digitales-fangbuch.html","ratgeber/beissverhalten-der-fische.html"]){
    const nodes=jsonLd(read(file)).flatMap(schemas);
    const article=nodes.find(node=>node["@type"]==="BlogPosting");
    const breadcrumbs=nodes.find(node=>node["@type"]==="BreadcrumbList");
    assert.ok(article,`${file}: BlogPosting`);
    const imageUrl=typeof article.image==="string"?article.image:article.image.url;
    assert.ok(imageUrl.startsWith("https://www.petriklar.com/assets/images/"));
    assert.equal(article.publisher.name,"PetriKlar");
    assert.match(article.dateModified,/^2026-08-20$/);
    assert.ok(breadcrumbs.itemListElement.length>=3,`${file}: Breadcrumbs`);
  }
});

test("Sitemap enthaelt nur kanonische Suchseiten samt Bildsignalen",()=>{
  const sitemap=read("sitemap.xml");
  const locations=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
  assert.deepEqual(locations,publicPages.map(([,canonical])=>canonical));
  assert.doesNotMatch(sitemap,/https:\/\/petriklar\.com\//);
  assert.equal((sitemap.match(/<image:image>/g)||[]).length,4);
  assert.match(read("robots.txt"),/Sitemap: https:\/\/www\.petriklar\.com\/sitemap\.xml/);
});

test("Hilfs-, App- und Entwurfsseiten bleiben aus dem Suchindex",()=>{
  const noIndexPages=["app.html","offline.html","404.html","legal/datenschutz.html","legal/impressum.html","legal/konto-loeschen.html","legal/support.html"];
  for(const file of noIndexPages) assert.match(read(file),/<meta name="robots" content="noindex,(?:no)?follow"/i,`${file}: noindex`);
});

test("SEO-Bilder sind gross genug und auf den Suchseiten verknuepft",()=>{
  const images=["assets/images/angel-app-digitales-fangbuch.jpg","assets/images/beissverhalten-fische-angel-app.jpg"];
  for(const file of images) assert.ok(fs.statSync(path.join(root,file)).size>100_000,`${file}: hochwertige Bilddatei`);
  assert.match(read("index.html"),/width="1200" height="630" loading="lazy"/);
  assert.match(read("ratgeber/angel-app-digitales-fangbuch.html"),/angel-app-digitales-fangbuch\.jpg/);
  assert.match(read("ratgeber/beissverhalten-der-fische.html"),/beissverhalten-fische-angel-app\.jpg/);
});

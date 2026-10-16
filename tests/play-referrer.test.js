// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const R = require("../assets/play-referrer.js");
const PLAY = "https://play.google.com/store/apps/details?id=world.solgram.customer&referrer=";
const ROOT = path.join(__dirname, "..");

// The app decodes the referrer once (Play hands it decoded), then `dl` once more.
const decodeTwice = (playUrl) => {
  const referrer = new URL(playUrl).searchParams.get("referrer"); // decoded once by URL parsing
  assert.ok(referrer.startsWith("dl="));
  return decodeURIComponent(referrer.slice(3));
};

test("encodes dl twice and round-trips", () => {
  const dest = "https://solgram.world/product/SKU-1";
  const url = R.playUrlFor(dest);
  assert.strictEqual(url, PLAY + encodeURIComponent("dl=" + encodeURIComponent(dest)));
  assert.strictEqual(decodeTwice(url), dest);
});

test("keeps the query string of a referral destination intact", () => {
  const dest = R.referralDestination("SG1A");
  assert.strictEqual(dest, "https://solgram.world/referral?referral_code=SG1A&deep_link_sub1=SG1A");
  assert.strictEqual(decodeTwice(R.playUrlFor(dest)), dest);
});

test("rejects a bad referral code", () => {
  for (const bad of ["", "a", "x".repeat(33), "SG 1", "SG1&x=1", "SG1/../", null, undefined]) {
    assert.strictEqual(R.referralDestination(bad), null, String(bad));
  }
  assert.ok(R.referralDestination("ab"));
  assert.ok(R.referralDestination("x".repeat(32)));
  assert.ok(R.referralDestination("A_b-9"));
});

test("rejects wrong host, scheme, port, userinfo", () => {
  for (const dest of [
    "https://www.solgram.world/product/1",
    "https://evil.com/product/1",
    "https://solgram.world.evil.com/product/1",
    "http://solgram.world/product/1",
    "https://solgram.world:8443/product/1",
    "https://user@solgram.world/product/1",
    "https://user:pw@solgram.world/product/1",
    "not a url",
    "",
    null,
  ]) {
    assert.strictEqual(R.playUrlFor(dest), null, String(dest));
  }
});

test("rejects whitespace, control characters and encoded ones", () => {
  for (const dest of [
    "https://solgram.world/product/a b",
    "https://solgram.world/product/a\tb",
    "https://solgram.world/product/a\nb",
    "https://solgram.world/product/a%20b",
    "https://solgram.world/product/a%0Ab",
    "https://solgram.world/product/a%00b",
  ]) {
    assert.strictEqual(R.playUrlFor(dest), null, JSON.stringify(dest));
  }
});

test("enforces the 512 character limit", () => {
  const base = "https://solgram.world/product/";
  assert.ok(R.playUrlFor(base + "a".repeat(512 - base.length)));
  assert.strictEqual(R.playUrlFor(base + "a".repeat(513 - base.length)), null);
});

test("rejects a malformed percent sequence", () => {
  assert.strictEqual(R.playUrlFor("https://solgram.world/product/%E0%A4%A"), null);
});

test("canonicalFromLocation drops hash-free noise: noredirect and utm_*", () => {
  const loc = { hostname: "solgram.world", pathname: "/category/ABC/DEF", search: "?x=1&utm_source=a&noredirect=1&UTM_medium=b&y=2" };
  assert.strictEqual(R.canonicalFromLocation(loc), "https://solgram.world/category/ABC/DEF?x=1&y=2");
  assert.strictEqual(
    R.canonicalFromLocation({ hostname: "solgram.world", pathname: "/cart", search: "" }),
    "https://solgram.world/cart",
  );
});

test("www host is rejected end to end (falls back to OneLink)", () => {
  const dest = R.canonicalFromLocation({ hostname: "www.solgram.world", pathname: "/product/1", search: "" });
  assert.strictEqual(R.playUrlFor(dest), null);
});

// ---- run the real inline page scripts against stubs ----

const ONELINK = "https://solgram.onelink.me/kyZR/referral2026";

const runPage = (file, { ua, platform = "Linux armv8l", pathname, search, helper = true }) => {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.strictEqual(scripts.length, 1);

  const content = { innerHTML: "" };
  const logo = { style: {} };
  const replaced = [];
  const timers = [];
  const location = { pathname, search, hostname: "solgram.world", replace: (u) => replaced.push(u), href: "" };
  const window = {};
  if (helper) window.solgramPlayReferrer = R;
  const sandbox = {
    window,
    location,
    document: {
      getElementById: (id) => (id.endsWith("-logo") || id === "redirect-logo" ? logo : id.endsWith("content") ? content : { addEventListener() {} }),
    },
    navigator: { userAgent: ua, vendor: "", platform, maxTouchPoints: 0 },
    setTimeout: (fn) => timers.push(fn),
    decodeURIComponent,
    encodeURIComponent,
    RegExp,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(scripts[0], sandbox);
  timers.forEach((fn) => fn());
  return { html: content.innerHTML, replaced };
};

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";

test("404 page: Android product link goes to Play with the page URL as dl", () => {
  const r = runPage("404.html", { ua: ANDROID, pathname: "/product/SKU-1", search: "" });
  assert.strictEqual(r.replaced.length, 1);
  assert.strictEqual(decodeTwice(r.replaced[0]), "https://solgram.world/product/SKU-1");
  assert.ok(r.html.includes('href="' + r.replaced[0] + '"'));
});

test("404 page: every supported path type works on Android", () => {
  for (const p of ["/category/C1", "/category/C1/S1", "/subcategory/S1", "/screen/diwali", "/order/SOLG-123", "/cart"]) {
    const r = runPage("404.html", { ua: ANDROID, pathname: p, search: "" });
    assert.strictEqual(r.replaced.length, 1, p);
    assert.strictEqual(decodeTwice(r.replaced[0]), "https://solgram.world" + p, p);
  }
});

test("404 page: iPhone and desktop are unchanged (OneLink / no redirect)", () => {
  const ios = runPage("404.html", { ua: IPHONE, platform: "iPhone", pathname: "/product/SKU-1", search: "" });
  assert.strictEqual(ios.replaced.length, 1);
  assert.ok(ios.replaced[0].startsWith(ONELINK + "?deep_link_sub3=product"));
  const desk = runPage("404.html", { ua: DESKTOP, platform: "Win32", pathname: "/product/SKU-1", search: "" });
  assert.strictEqual(desk.replaced.length, 0);
});

test("404 page: Android falls back to OneLink when the URL is invalid or the helper is missing", () => {
  const long = runPage("404.html", { ua: ANDROID, pathname: "/product/" + "a".repeat(600), search: "" });
  assert.ok(long.replaced[0].startsWith(ONELINK));
  const noHelper = runPage("404.html", { ua: ANDROID, pathname: "/product/SKU-1", search: "", helper: false });
  assert.ok(noHelper.replaced[0].startsWith(ONELINK));
});

test("404 page: unknown path stays a plain 404 and noredirect still stops the redirect", () => {
  const nf = runPage("404.html", { ua: ANDROID, pathname: "/nope", search: "" });
  assert.strictEqual(nf.replaced.length, 0);
  const nr = runPage("404.html", { ua: ANDROID, pathname: "/product/SKU-1", search: "?noredirect=1" });
  assert.strictEqual(nr.replaced.length, 0);
});

test("referral page: Android gets the Play URL with the referral link as dl", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?referral_code=SG1A&deep_link_sub1=SG1A" });
  assert.strictEqual(r.replaced.length, 1);
  assert.strictEqual(
    decodeTwice(r.replaced[0]),
    "https://solgram.world/referral?referral_code=SG1A&deep_link_sub1=SG1A",
  );
});

test("referral page: only one of the two params still yields both in dl", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?deep_link_sub1=SG9" });
  assert.strictEqual(
    decodeTwice(r.replaced[0]),
    "https://solgram.world/referral?referral_code=SG9&deep_link_sub1=SG9",
  );
});

test("referral page: invalid code on Android keeps the OneLink; iPhone does not auto-redirect", () => {
  const bad = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "?referral_code=a" });
  assert.ok(bad.replaced[0].startsWith(ONELINK));
  const ios = runPage("referral/index.html", { ua: IPHONE, platform: "iPhone", pathname: "/referral/", search: "?referral_code=SG1A" });
  assert.strictEqual(ios.replaced.length, 0);
  assert.ok(ios.html.includes(ONELINK + "?referral_code=SG1A"));
});

test("referral page: no code renders the existing message and no redirect", () => {
  const r = runPage("referral/index.html", { ua: ANDROID, pathname: "/referral/", search: "" });
  assert.strictEqual(r.replaced.length, 0);
});

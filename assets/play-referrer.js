/*
 * Builds the link that carries a first-party destination through an install.
 *
 * Android: the Play Store URL with the Play "install referrer". The app reads
 * `dl` on its first launch.
 *   referrer = encodeURIComponent('dl=' + encodeURIComponent(destination)).
 *
 * iPhone: a Singular tracking link (solgram.sng.link) with the destination in
 * `_dl` and `_ddl`, plus referral_code / deep_link_sub1 for a referral.
 *
 * Both use the same destination rules: https://solgram.world/... (apex host),
 * at most 512 characters, no whitespace or control characters. Anything else
 * returns null so the caller keeps its existing redirect.
 */
(function (root) {
  var HOST = "solgram.world";
  var PLAY_URL = "https://play.google.com/store/apps/details?id=world.solgram.customer";
  // Created in Singular (source "Referral (Custom)"). Kept exactly as issued,
  // including _smtype=3; it already has a "?", so every extra parameter joins with "&".
  var SINGULAR_BASE_URL = "https://solgram.sng.link/D6ktt/dxit?_smtype=3";
  var MAX_LENGTH = 512;
  var CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;

  function hasBadChars(value) {
    // whitespace or control characters (C0, DEL, C1)
    return /[\s\u0000-\u001f\u007f-\u009f]/.test(value);
  }

  // True when a destination passes every rule the app enforces.
  function isValidDestination(destination) {
    if (typeof destination !== "string" || destination.length === 0) return false;
    if (destination.length > MAX_LENGTH) return false;

    var decoded;
    try {
      decoded = decodeURIComponent(destination);
    } catch (e) {
      return false;
    }
    if (decoded.length > MAX_LENGTH) return false;
    if (hasBadChars(destination) || hasBadChars(decoded)) return false;

    var parsed;
    try {
      parsed = new URL(destination);
    } catch (e) {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== HOST) return false;
    if (parsed.port !== "") return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
    return true;
  }

  // Returns the Play URL for a destination, or null when the destination
  // fails any of the app's rules.
  function playUrlFor(destination) {
    if (!isValidDestination(destination)) return null;
    var referrer = encodeURIComponent("dl=" + encodeURIComponent(destination));
    return PLAY_URL + "&referrer=" + referrer;
  }

  // iPhone: the Singular link for a destination, or null when it fails the
  // same rules. _dl and _ddl carry the SAME value, encoded once. For a referral
  // pass the code: it must match the code rule, and is appended as ordinary
  // query parameters (an invalid code returns null, never a link without it).
  function singularUrlFor(destination, referralCode) {
    if (!isValidDestination(destination)) return null;
    var encoded = encodeURIComponent(destination);
    var url = SINGULAR_BASE_URL + "&_dl=" + encoded + "&_ddl=" + encoded;
    if (referralCode !== undefined && referralCode !== null) {
      if (typeof referralCode !== "string" || !CODE_RE.test(referralCode)) return null;
      var c = encodeURIComponent(referralCode);
      url += "&referral_code=" + c + "&deep_link_sub1=" + c;
    }
    return url;
  }

  // The current page's own canonical URL: origin + path + query, without the
  // hash, `noredirect` (a debug switch) or utm_* (kept out of `dl`).
  function canonicalFromLocation(loc) {
    var params = [];
    var search = (loc.search || "").replace(/^\?/, "");
    if (search) {
      search.split("&").forEach(function (pair) {
        if (!pair) return;
        var name = pair.split("=")[0];
        var lower = name.toLowerCase();
        if (lower === "noredirect" || lower.indexOf("utm_") === 0) return;
        params.push(pair);
      });
    }
    return "https://" + loc.hostname + loc.pathname + (params.length ? "?" + params.join("&") : "");
  }

  // Referral link: built from the code, not from the raw URL, so both
  // parameters are always present and the code is always well formed.
  function referralDestination(code) {
    if (typeof code !== "string" || !CODE_RE.test(code)) return null;
    var c = encodeURIComponent(code);
    return "https://" + HOST + "/referral?referral_code=" + c + "&deep_link_sub1=" + c;
  }

  var api = {
    playUrlFor: playUrlFor,
    singularUrlFor: singularUrlFor,
    canonicalFromLocation: canonicalFromLocation,
    referralDestination: referralDestination,
  };

  root.solgramPlayReferrer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

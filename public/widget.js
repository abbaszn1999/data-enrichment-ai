/**
 * Autommerce Widget Embed Script (widget.js)
 * Automatically fetches and renders FAQs and Semantic Internal Links on Shopify & WooCommerce stores.
 * Supports customizable templates, fonts, sizes, and colors.
 */
(function () {
  "use strict";

  // Prevent multiple script initializations
  if (window.__dea_widget_loaded) {
    if (typeof window.__dea_init === "function") {
      window.__dea_init();
    }
    return;
  }
  window.__dea_widget_loaded = true;

  var DEFAULT_PROD_API = "https://platform.autommerce.com";

  // Derive the API origin from this script's own src so a host change
  // cannot freeze a retired Render URL inside merchant themes.
  function getApiBaseUrl() {
    var scriptEl =
      document.currentScript ||
      (function () {
        var scripts = document.getElementsByTagName("script");
        for (var i = scripts.length - 1; i >= 0; i--) {
          var s = scripts[i].src || "";
          if (s.indexOf("widget.js") !== -1) {
            return scripts[i];
          }
        }
        return null;
      })();

    if (scriptEl && scriptEl.src) {
      try {
        var u = new URL(scriptEl.src);
        if (u.origin && u.origin !== "null") return u.origin;
      } catch (e) {}
    }

    if (typeof window !== "undefined" && window.location && window.location.hostname === "localhost") {
      return window.location.origin;
    }

    return DEFAULT_PROD_API;
  }

  var API_BASE = getApiBaseUrl();

  // Resolve Store Domain (Shopify store domain or current hostname)
  function getStoreDomain() {
    try {
      if (window.Shopify && window.Shopify.shop) {
        return window.Shopify.shop;
      }
      if (window.location && window.location.hostname) {
        return window.location.hostname;
      }
    } catch (e) {}
    return "";
  }

  // Extract collection handle from pathname or element attribute
  function resolveCollectionHandle(element) {
    var attrHandle = (element.getAttribute("data-collection") || "").trim();

    // If explicit handle is provided and not a placeholder/liquid template tag
    if (
      attrHandle &&
      attrHandle !== "current" &&
      attrHandle !== "polarized-sunglasses" &&
      attrHandle !== "{{ collection.handle }}" &&
      !attrHandle.startsWith("{{")
    ) {
      return attrHandle;
    }

    // 1. Auto-detect from URL pathname (Shopify /collections/handle)
    var path = (window.location && window.location.pathname) || "";
    var shopifyMatch = path.match(/\/collections\/([^/?#]+)/i);
    if (shopifyMatch && shopifyMatch[1]) {
      return decodeURIComponent(shopifyMatch[1]);
    }

    // 2. Auto-detect from WooCommerce category URL (/product-category/slug)
    var wooMatch = path.match(/\/product-category\/([^/?#]+)/i);
    if (wooMatch && wooMatch[1]) {
      return decodeURIComponent(wooMatch[1]);
    }

    // 3. Check Shopify global analytics object if present
    try {
      if (
        window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.page &&
        window.ShopifyAnalytics.meta.page.handle
      ) {
        return String(window.ShopifyAnalytics.meta.page.handle);
      }
    } catch (e) {}

    return attrHandle || "current";
  }

  // Inject Styles for the widgets once
  function injectStyles() {
    if (document.getElementById("dea-widget-styles")) return;
    var style = document.createElement("style");
    style.id = "dea-widget-styles";
    style.textContent = `
      .dea-widget-container {
        box-sizing: border-box;
        width: 100%;
        margin-left: auto;
        margin-right: auto;
        margin-top: 2rem;
        margin-bottom: 2rem;
      }
      .dea-widget-container * {
        box-sizing: border-box;
      }
      .dea-widget-inner {
        width: 100%;
        border-radius: 12px;
      }
      .dea-heading {
        font-weight: 650;
        letter-spacing: -0.02em;
        margin: 0 0 16px 0;
        line-height: 1.3;
      }

      /* FAQ Styles */
      .dea-faq-list {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
      .dea-faq-grid-split {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
        width: 100%;
      }
      @media (min-width: 768px) {
        .dea-faq-grid-split {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      .dea-faq-card {
        overflow: hidden;
        transition: all 0.2s ease;
      }
      .dea-faq-question {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        font-weight: 600;
        gap: 12px;
        user-select: none;
        font-family: inherit;
      }
      .dea-faq-question:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: -2px;
      }
      .dea-faq-icon {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        transition: transform 0.25s ease;
      }
      .dea-faq-card.is-open .dea-faq-icon {
        transform: rotate(180deg);
      }
      .dea-faq-answer {
        display: none;
        line-height: 1.6;
      }
      .dea-faq-card.is-open .dea-faq-answer {
        display: block;
        animation: dea-fade-in 0.2s ease;
      }
      @keyframes dea-fade-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Links Styles */
      .dea-links-wrap-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }
      .dea-link-pill {
        display: inline-flex;
        align-items: center;
        padding: 8px 16px;
        border-radius: 9999px;
        font-weight: 500;
        text-decoration: none;
        transition: all 0.2s ease;
      }
      .dea-link-pill:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
      }

      /* Tiles Link Template */
      .dea-links-grid-tiles {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        width: 100%;
      }
      @media (min-width: 640px) {
        .dea-links-grid-tiles {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      .dea-link-tile {
        display: flex;
        flex-direction: column;
        text-decoration: none;
        border-radius: 10px;
        overflow: hidden;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .dea-link-tile:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 10px rgba(0,0,0,0.07);
      }
      .dea-tile-thumb {
        width: 100%;
        aspect-ratio: 4/3;
        border-radius: 8px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dea-tile-label {
        font-weight: 550;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Circles Link Template */
      .dea-links-circles-wrap {
        display: flex;
        gap: 16px;
        overflow-x: auto;
        padding-bottom: 8px;
        scrollbar-width: thin;
      }
      .dea-link-circle {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        text-decoration: none;
        width: 80px;
        flex-shrink: 0;
        transition: transform 0.2s ease;
      }
      .dea-link-circle:hover {
        transform: scale(1.05);
      }
      .dea-circle-thumb {
        width: 58px;
        height: 58px;
        border-radius: 50%;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .dea-circle-label {
        font-size: 0.8125rem;
        line-height: 1.25;
        font-weight: 500;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Rail Link Template */
      .dea-links-rail-wrap {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
      }
      .dea-rail-link {
        text-decoration: none;
        font-weight: 500;
        transition: opacity 0.2s;
      }
      .dea-rail-link:hover {
        text-decoration: underline;
      }
      .dea-rail-sep {
        opacity: 0.4;
      }
    `;
    (document.head || document.body).appendChild(style);
  }

  function getFontStack(font) {
    if (!font || font === "default") return "inherit";
    if (font === "serif") return "ui-serif, Georgia, 'Times New Roman', serif";
    if (font === "rounded") return "ui-rounded, 'Nunito', 'Trebuchet MS', sans-serif";
    if (font === "sans") return "ui-sans-serif, system-ui, -apple-system, sans-serif";
    return "inherit";
  }

  // Read the live font sizes the theme already uses on this page.
  function getThemeFontSizes(el) {
    var body = 16;
    var heading = 22;
    try {
      var scope = (el && el.closest("main")) || document.querySelector("main") || document.body;

      var textNode =
        scope.querySelector(".rte p, .rte, main p, p, li") ||
        document.body;
      var textSize = parseFloat(window.getComputedStyle(textNode).fontSize);
      if (textSize > 0) body = textSize;

      var headingNode = scope.querySelector("h2, h1, .collection-hero__title, .title");
      if (headingNode) {
        var headingSize = parseFloat(window.getComputedStyle(headingNode).fontSize);
        // Hero titles can be oversized; keep the widget heading sane.
        if (headingSize > 0) {
          heading = headingSize > 40 ? Math.max(body * 1.4, 28) : headingSize;
        }
      } else {
        heading = body * 1.4;
      }
    } catch (e) {}

    return { body: body, heading: heading };
  }

  function getFontSizes(size, el) {
    if (size === "sm") {
      return { heading: "1.1rem", item: "0.8125rem", pad: "10px" };
    }
    if (size === "lg") {
      return { heading: "1.45rem", item: "1.05rem", pad: "18px" };
    }
    if (size === "md") {
      return { heading: "1.25rem", item: "0.9375rem", pad: "14px" };
    }
    // "default" — inherit the theme's own typography scale.
    var theme = getThemeFontSizes(el);
    return {
      heading: theme.heading + "px",
      item: theme.body + "px",
      pad: Math.round(theme.body * 0.9) + "px",
    };
  }

  // Find the container the theme uses for page content, so the widget lines up
  // with the collection title / description instead of guessing a width.
  function findThemeContainer(el) {
    var selectors = [
      ".page-width",
      ".container",
      ".shopify-section .page-width",
      "main .container",
      ".site-container",
      ".main-content .container",
    ];

    var best = null;
    var bestWidth = 0;

    for (var s = 0; s < selectors.length; s++) {
      var nodes;
      try {
        nodes = document.querySelectorAll(selectors[s]);
      } catch (e) {
        continue;
      }
      for (var i = 0; i < nodes.length; i++) {
        var rect = nodes[i].getBoundingClientRect();
        if (rect.width < 200 || rect.height < 1) continue;
        if (nodes[i].contains(el)) continue;
        if (rect.width > bestWidth) {
          bestWidth = rect.width;
          best = nodes[i];
        }
      }
    }

    return best;
  }

  // Match the rendered widget's width and horizontal offset to the theme container.
  function alignToTheme(el) {
    try {
      var inner = el.querySelector(".dea-widget-container");
      if (!inner) return;

      var ref = findThemeContainer(el);
      if (!ref) return;

      var refStyle = window.getComputedStyle(ref);
      var refRect = ref.getBoundingClientRect();
      var refPadLeft = parseFloat(refStyle.paddingLeft) || 0;
      var refPadRight = parseFloat(refStyle.paddingRight) || 0;
      var contentLeft = refRect.left + refPadLeft;
      var contentWidth = refRect.width - refPadLeft - refPadRight;
      if (contentWidth < 120) return;

      var parent = el.parentElement || el;
      var parentStyle = window.getComputedStyle(parent);
      var parentRect = parent.getBoundingClientRect();
      var parentContentLeft = parentRect.left + (parseFloat(parentStyle.paddingLeft) || 0);

      var offset = contentLeft - parentContentLeft;
      if (offset < 0) offset = 0;

      inner.style.maxWidth = "none";
      inner.style.width = contentWidth + "px";
      inner.style.marginLeft = offset + "px";
      inner.style.marginRight = "0";
    } catch (e) {}
  }

  var alignTimer = null;
  function scheduleRealign() {
    if (alignTimer) clearTimeout(alignTimer);
    alignTimer = setTimeout(function () {
      var rendered = document.querySelectorAll("[data-dea][data-dea-rendered]");
      for (var i = 0; i < rendered.length; i++) {
        alignToTheme(rendered[i]);
      }
    }, 120);
  }

  // Render FAQs inside container with customized styles
  function renderFaq(container, faqs, customStyle) {
    if (!faqs || faqs.length === 0) {
      container.innerHTML = "";
      return;
    }

    var style = customStyle || {};
    var template = style.template || "dividers";
    var headingText = style.heading || "Frequently Asked Questions";
    var headingColor = style.headingColor || "#111827";
    var textColor = style.textColor || "#4b5563";
    var accentColor = style.accentColor || "#2563eb";
    var backgroundColor = style.backgroundColor || "transparent";
    var fontFamily = getFontStack(style.font);
    var sizes = getFontSizes(style.size, container);

    var isSplit = template === "split";
    var isCards = template === "cards";
    var isAccent = template === "accent";
    var isDividers = template === "dividers";
    var isEditorial = template === "editorial";

    var containerStyle = 'font-family:' + fontFamily + ';';
    if (backgroundColor && backgroundColor !== "#ffffff" && backgroundColor !== "transparent") {
      containerStyle += 'background:' + backgroundColor + ';padding:' + sizes.pad + ';border-radius:12px;';
    }

    var html = '<div class="dea-widget-container dea-faq-wrap" style="' + containerStyle + '">';
    html += '<h3 class="dea-heading" style="color:' + headingColor + ';font-size:' + sizes.heading + ';">' + escapeHtml(headingText) + '</h3>';

    var listClass = isSplit ? "dea-faq-grid-split" : "dea-faq-list";
    var listStyle = (isDividers || isEditorial) ? "gap:0;" : "gap:10px;";
    html += '<div class="' + listClass + '" style="' + listStyle + '">';

    for (var i = 0; i < faqs.length; i++) {
      var item = faqs[i];
      var openClass = i === 0 ? " is-open" : "";
      var cardStyle = "";

      if (isDividers || isEditorial) {
        cardStyle = "border-bottom: 1px solid " + hexToRgba(accentColor, 0.18) + "; border-radius:0;";
      } else if (isCards || isSplit) {
        cardStyle = "background:" + hexToRgba(accentColor, 0.05) + "; border: 1px solid " + hexToRgba(accentColor, 0.12) + "; border-radius: 12px;";
      } else if (isAccent) {
        cardStyle = "border-left: 3px solid " + (i === 0 ? accentColor : "transparent") + "; background:" + hexToRgba(accentColor, 0.03) + "; border-radius: 6px;";
      }

      html += '<div class="dea-faq-card' + openClass + '" style="' + cardStyle + '" data-accent-color="' + accentColor + '">';
      html += '<button type="button" class="dea-faq-question" style="color:' + headingColor + ';font-size:' + sizes.item + ';padding:' + sizes.pad + ';" aria-expanded="' + (i === 0 ? "true" : "false") + '">';
      html += '<span>' + escapeHtml(item.q) + '</span>';
      html += '<svg class="dea-faq-icon" style="stroke:' + accentColor + ';" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      html += '</button>';
      html += '<div class="dea-faq-answer" style="color:' + textColor + ';font-size:' + sizes.item + ';padding: 0 ' + sizes.pad + ' ' + sizes.pad + ' ' + sizes.pad + ';">' + escapeHtml(item.a) + '</div>';
      html += '</div>';
    }

    html += '</div></div>';
    container.innerHTML = html;

    // Attach click listeners
    var buttons = container.querySelectorAll(".dea-faq-question");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function () {
        var card = this.closest(".dea-faq-card");
        if (!card) return;
        var isOpen = card.classList.contains("is-open");
        card.classList.toggle("is-open", !isOpen);
        this.setAttribute("aria-expanded", !isOpen ? "true" : "false");

        // Dynamic accent line update for accent template
        if (card.style.borderLeft) {
          var acc = card.getAttribute("data-accent-color") || "#2563eb";
          card.style.borderLeftColor = !isOpen ? acc : "transparent";
        }
      });
    }

    alignToTheme(container);
  }

  // Render Internal Links inside container with customized styles
  // A link pointing at the page we are already on is noise, so drop it.
  function dropSelfLinks(links, currentHandle) {
    if (!links || !currentHandle) return links || [];
    var out = [];
    for (var i = 0; i < links.length; i++) {
      var href = String((links[i] && links[i].href) || "");
      var handle = href
        .replace(/[?#].*$/, "")
        .replace(/\/+$/, "")
        .split("/")
        .pop();
      if ((handle || "").toLowerCase() !== currentHandle.toLowerCase()) {
        out.push(links[i]);
      }
    }
    return out;
  }

  function renderLinks(container, links, customStyle) {
    if (!links || links.length === 0) {
      container.innerHTML = "";
      return;
    }

    var style = customStyle || {};
    var template = style.template || "pills";
    var headingText = style.heading || "Explore Related Categories";
    var headingColor = style.headingColor || "#111827";
    var textColor = style.textColor || "#4b5563";
    var accentColor = style.accentColor || "#2563eb";
    var backgroundColor = style.backgroundColor || "transparent";
    var fontFamily = getFontStack(style.font);
    var sizes = getFontSizes(style.size, container);

    var containerStyle = 'font-family:' + fontFamily + ';';
    if (backgroundColor && backgroundColor !== "#ffffff" && backgroundColor !== "transparent") {
      containerStyle += 'background:' + backgroundColor + ';padding:' + sizes.pad + ';border-radius:12px;';
    }

    var html = '<div class="dea-widget-container dea-links-widget" style="' + containerStyle + '">';
    html += '<h3 class="dea-heading" style="color:' + headingColor + ';font-size:' + sizes.heading + ';">' + escapeHtml(headingText) + '</h3>';

    if (template === "tiles") {
      html += '<div class="dea-links-grid-tiles">';
      for (var i = 0; i < links.length; i++) {
        var item = links[i];
        var href = item.href || "#";
        var tileBg = hexToRgba(accentColor, 0.08 + (i % 4) * 0.04);
        html += '<a href="' + escapeHtml(href) + '" class="dea-link-tile" style="padding:10px;background:' + tileBg + ';border:1px solid ' + hexToRgba(accentColor, 0.15) + ';">';
        html += '<div class="dea-tile-thumb" style="background:' + hexToRgba(accentColor, 0.14) + ';color:' + accentColor + ';">';
        html += '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="3"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
        html += '</div>';
        html += '<span class="dea-tile-label" style="color:' + headingColor + ';font-size:' + sizes.item + ';">' + escapeHtml(item.label) + '</span>';
        html += '</a>';
      }
      html += '</div>';
    } else if (template === "circles") {
      html += '<div class="dea-links-circles-wrap">';
      for (var i = 0; i < links.length; i++) {
        var item = links[i];
        var href = item.href || "#";
        html += '<a href="' + escapeHtml(href) + '" class="dea-link-circle">';
        html += '<div class="dea-circle-thumb" style="background:' + hexToRgba(accentColor, 0.12) + ';border:2px solid ' + hexToRgba(accentColor, 0.3) + ';color:' + accentColor + ';">';
        html += '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
        html += '</div>';
        html += '<span class="dea-circle-label" style="color:' + headingColor + ';">' + escapeHtml(item.label) + '</span>';
        html += '</a>';
      }
      html += '</div>';
    } else if (template === "rail") {
      html += '<div class="dea-links-rail-wrap">';
      for (var i = 0; i < links.length; i++) {
        var item = links[i];
        var href = item.href || "#";
        html += '<a href="' + escapeHtml(href) + '" class="dea-rail-link" style="color:' + headingColor + ';font-size:' + sizes.item + ';">' + escapeHtml(item.label) + '</a>';
        if (i < links.length - 1) {
          html += '<span class="dea-rail-sep" style="color:' + accentColor + ';font-size:' + sizes.item + ';">/</span>';
        }
      }
      html += '</div>';
    } else {
      // Default: "pills" or "editorial"
      html += '<div class="dea-links-wrap-pills">';
      for (var i = 0; i < links.length; i++) {
        var item = links[i];
        var href = item.href || "#";
        var pillStyle = 'color:' + headingColor + ';background:' + hexToRgba(accentColor, 0.08) + ';border:1px solid ' + hexToRgba(accentColor, 0.25) + ';font-size:' + sizes.item + ';';
        html += '<a href="' + escapeHtml(href) + '" class="dea-link-pill" style="' + pillStyle + '">';
        html += '<span>' + escapeHtml(item.label) + '</span>';
        html += '</a>';
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    alignToTheme(container);
  }

  function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== "string") return "rgba(37,99,235," + alpha + ")";
    var clean = hex.replace("#", "");
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (clean.length !== 6) return "rgba(37,99,235," + alpha + ")";
    var r = parseInt(clean.substring(0, 2), 16);
    var g = parseInt(clean.substring(2, 4), 16);
    var b = parseInt(clean.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Cache for fetched collection content
  var cache = {};

  function fetchCollectionContent(domain, collectionHandle, callback) {
    var cacheKey = domain + "::" + collectionHandle;
    if (cache[cacheKey]) {
      callback(null, cache[cacheKey]);
      return;
    }

    var url =
      API_BASE +
      "/api/embed/content?domain=" +
      encodeURIComponent(domain) +
      "&collection=" +
      encodeURIComponent(collectionHandle);

    if (typeof fetch === "function") {
      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          cache[cacheKey] = data;
          callback(null, data);
        })
        .catch(function (err) {
          callback(err, null);
        });
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            cache[cacheKey] = data;
            callback(null, data);
          } catch (e) {
            callback(e, null);
          }
        } else {
          callback(new Error("HTTP " + xhr.status), null);
        }
      }
    };
    xhr.onerror = function () {
      callback(new Error("Network error"), null);
    };
    xhr.send();
  }

  // Main initialize loop
  function initWidgets() {
    try {
      injectStyles();

      var elements = document.querySelectorAll("[data-dea]:not([data-dea-rendered])");
      if (!elements || elements.length === 0) return;

      var domain = getStoreDomain();

      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        el.setAttribute("data-dea-rendered", "true");

        (function (targetEl) {
          var kind = (targetEl.getAttribute("data-dea") || "").toLowerCase().trim();
          var collectionHandle = resolveCollectionHandle(targetEl);

          if (!collectionHandle) return;

          fetchCollectionContent(domain, collectionHandle, function (err, data) {
            if (err || !data) {
              console.warn("[Autommerce Widget] Failed to load content:", err || "No data");
              return;
            }

            var widgetSettings = data.widgetSettings || {};
            var faqStyle = widgetSettings.faq || null;
            var linksStyle = widgetSettings.links || null;

            if (kind === "faq") {
              renderFaq(targetEl, data.faqs || [], faqStyle);
            } else if (kind === "links") {
              renderLinks(
                targetEl,
                dropSelfLinks(data.links || [], collectionHandle),
                linksStyle
              );
            }
          });
        })(el);
      }
    } catch (e) {
      console.error("[Autommerce Widget] init error:", e);
    }
  }

  window.__dea_init = initWidgets;

  // Run on DOM ready and load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidgets);
  } else {
    initWidgets();
  }

  // Theme layout and web fonts settle after load — re-measure then.
  window.addEventListener("load", scheduleRealign);
  window.addEventListener("resize", scheduleRealign);
  window.addEventListener("orientationchange", scheduleRealign);
  try {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(scheduleRealign);
    }
  } catch (e) {}

  // Safe Debounced MutationObserver for dynamic themes
  if (typeof MutationObserver !== "undefined") {
    var debounceTimer = null;
    var observer = new MutationObserver(function () {
      var hasUnrendered = document.querySelector("[data-dea]:not([data-dea-rendered])");
      if (!hasUnrendered) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        initWidgets();
      }, 150);
    });

    try {
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {}
  }
})();

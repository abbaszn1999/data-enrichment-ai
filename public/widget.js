/**
 * Autommerce Widget Embed Script (widget.js)
 * Automatically fetches and renders FAQs and Semantic Internal Links on Shopify & WooCommerce stores.
 */
(function () {
  "use strict";

  // Prevent multiple initializations
  if (window.__dea_widget_loaded) return;
  window.__dea_widget_loaded = true;

  var DEFAULT_PROD_API = "https://data-enrichment-ai.onrender.com";

  // Determine the API base URL from the script tag's src
  function getApiBaseUrl() {
    var scriptEl =
      document.currentScript ||
      (function () {
        var scripts = document.getElementsByTagName("script");
        for (var i = scripts.length - 1; i >= 0; i--) {
          if (scripts[i].src && (scripts[i].src.indexOf("widget.js") !== -1 || scripts[i].src.indexOf("data-enrichment-ai") !== -1)) {
            return scripts[i];
          }
        }
        return null;
      })();

    if (scriptEl && scriptEl.src) {
      try {
        var u = new URL(scriptEl.src);
        return u.origin;
      } catch (e) {}
    }

    // If running on localhost, use localhost, otherwise default to production Render URL
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

  // Inject Styles for the widgets
  function injectStyles() {
    if (document.getElementById("dea-widget-styles")) return;
    var style = document.createElement("style");
    style.id = "dea-widget-styles";
    style.textContent = `
      .dea-widget-container {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        box-sizing: border-box;
        margin: 28px 0;
        width: 100%;
        color: #1a1a1a;
      }
      .dea-widget-container * {
        box-sizing: border-box;
      }
      .dea-faq-heading, .dea-links-heading {
        font-size: 1.25rem;
        font-weight: 650;
        letter-spacing: -0.02em;
        margin: 0 0 16px 0;
        color: #111827;
      }
      .dea-faq-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .dea-faq-card {
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: #fdfdfd;
        border-radius: 12px;
        overflow: hidden;
        transition: all 0.2s ease;
      }
      .dea-faq-card:hover {
        border-color: rgba(0, 0, 0, 0.16);
      }
      .dea-faq-question {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        font-size: 0.9375rem;
        font-weight: 600;
        color: #1f2937;
        gap: 12px;
        user-select: none;
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
        stroke: #6b7280;
      }
      .dea-faq-card.is-open .dea-faq-icon {
        transform: rotate(180deg);
        stroke: #2563eb;
      }
      .dea-faq-answer {
        display: none;
        padding: 0 18px 16px 18px;
        font-size: 0.875rem;
        line-height: 1.6;
        color: #4b5563;
      }
      .dea-faq-card.is-open .dea-faq-answer {
        display: block;
        animation: dea-fade-in 0.2s ease;
      }
      @keyframes dea-fade-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .dea-links-wrap {
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
        font-size: 0.875rem;
        font-weight: 500;
        color: #2563eb;
        background: rgba(37, 99, 235, 0.06);
        border: 1px solid rgba(37, 99, 235, 0.2);
        text-decoration: none;
        transition: all 0.2s ease;
      }
      .dea-link-pill:hover {
        background: rgba(37, 99, 235, 0.12);
        border-color: rgba(37, 99, 235, 0.4);
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(37, 99, 235, 0.08);
      }
      .dea-link-pill:active {
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  // Render FAQs inside container
  function renderFaq(container, faqs) {
    if (!faqs || faqs.length === 0) {
      container.innerHTML = "";
      return;
    }

    var html = '<div class="dea-widget-container dea-faq-wrap">';
    html += '<h3 class="dea-faq-heading">Frequently Asked Questions</h3>';
    html += '<div class="dea-faq-list">';

    for (var i = 0; i < faqs.length; i++) {
      var item = faqs[i];
      var openClass = i === 0 ? " is-open" : "";
      html += '<div class="dea-faq-card' + openClass + '">';
      html += '<button type="button" class="dea-faq-question" aria-expanded="' + (i === 0 ? "true" : "false") + '">';
      html += '<span>' + escapeHtml(item.q) + '</span>';
      html += '<svg class="dea-faq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      html += '</button>';
      html += '<div class="dea-faq-answer">' + escapeHtml(item.a) + '</div>';
      html += '</div>';
    }

    html += '</div></div>';
    container.innerHTML = html;

    // Attach click listeners
    var buttons = container.querySelectorAll(".dea-faq-question");
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].addEventListener("click", function (e) {
        var card = this.closest(".dea-faq-card");
        var isOpen = card.classList.contains("is-open");
        card.classList.toggle("is-open", !isOpen);
        this.setAttribute("aria-expanded", !isOpen ? "true" : "false");
      });
    }
  }

  // Render Internal Links inside container
  function renderLinks(container, links) {
    if (!links || links.length === 0) {
      container.innerHTML = "";
      return;
    }

    var html = '<div class="dea-widget-container dea-links-widget">';
    html += '<h3 class="dea-links-heading">Explore Related Categories</h3>';
    html += '<div class="dea-links-wrap">';

    for (var i = 0; i < links.length; i++) {
      var item = links[i];
      var href = item.href || "#";
      html += '<a href="' + escapeHtml(href) + '" class="dea-link-pill">';
      html += '<span>' + escapeHtml(item.label) + '</span>';
      html += '</a>';
    }

    html += '</div></div>';
    container.innerHTML = html;
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
    injectStyles();

    var elements = document.querySelectorAll("[data-dea]");
    if (elements.length === 0) return;

    var domain = getStoreDomain();

    for (var i = 0; i < elements.length; i++) {
      (function (el) {
        var kind = (el.getAttribute("data-dea") || "").toLowerCase().trim();
        var collectionHandle = resolveCollectionHandle(el);

        if (!collectionHandle) return;

        fetchCollectionContent(domain, collectionHandle, function (err, data) {
          if (err || !data) {
            console.warn("[Autommerce Widget] Failed to load content:", err || "No data");
            return;
          }

          if (kind === "faq") {
            renderFaq(el, data.faqs || []);
          } else if (kind === "links") {
            renderLinks(el, data.links || []);
          }
        });
      })(elements[i]);
    }
  }

  // Run on DOM ready and load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidgets);
  } else {
    initWidgets();
  }

  // Also support dynamic themes (Shopify theme customizer re-renders)
  if (typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(function (mutations) {
      var hasNew = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
          hasNew = true;
          break;
        }
      }
      if (hasNew) initWidgets();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();

const FIGMA_HOST_RE = /(^|\.)figma\.com$/i;
const FIGMA_SITE_HOST_RE = /(^|\.)figma\.site$/i;
const EMBED_HOST = 'prototype-gif-recorder';

function htmlDecode(value) {
  if (typeof document === 'undefined') {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

export function extractFigmaInput(rawValue) {
  const value = htmlDecode(rawValue.trim());

  const iframeSrc = value.match(/<iframe[\s\S]*?\ssrc=(["'])(.*?)\1/i);
  if (iframeSrc?.[2]) {
    return iframeSrc[2];
  }

  const anchorHref = value.match(/<a\b[\s\S]*?\shref=(["'])(https?:\/\/[^"']+)\1/i);
  if (anchorHref?.[2]) {
    return anchorHref[2];
  }

  const markdownLink = value.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownLink?.[1]) {
    return markdownLink[1];
  }

  const figmaUrl = value.match(/https?:\/\/(?:[\w-]+\.)?figma\.com\/[^\s"'<>]+/i);
  if (figmaUrl?.[0]) {
    return figmaUrl[0];
  }

  return value;
}

function normalizeShareUrl(url) {
  const normalized = new URL(url.toString());
  normalized.hostname = 'www.figma.com';

  const parts = normalized.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    throw new Error('This Figma URL does not include a file path.');
  }

  if (parts[0] === 'design' || parts[0] === 'file') {
    parts[0] = 'proto';
  }

  if (parts[0] === 'make') {
    throw new Error('Figma Make editor links cannot be embedded here. Publish the Make file and paste its *.figma.site URL.');
  }

  if (parts[0] !== 'proto') {
    throw new Error('Use a Figma prototype, design URL, or embed code.');
  }

  normalized.pathname = `/${parts.join('/')}`;

  if (!normalized.searchParams.has('hide-ui')) {
    normalized.searchParams.set('hide-ui', '1');
  }

  return normalized;
}

function toDirectEmbedUrl(shareUrl) {
  const directUrl = new URL(shareUrl.toString());
  directUrl.hostname = 'embed.figma.com';
  directUrl.searchParams.set('embed-host', EMBED_HOST);
  return directUrl.toString();
}

function toWrapperEmbedUrl(shareUrl) {
  const embedUrl = new URL('https://www.figma.com/embed');
  embedUrl.searchParams.set('embed_host', EMBED_HOST);
  embedUrl.searchParams.set('url', shareUrl.toString());
  return embedUrl.toString();
}

function uniqueUrls(urls) {
  return [...new Set(urls)];
}

export function toFigmaEmbedUrls(rawValue) {
  let url;
  try {
    url = new URL(extractFigmaInput(rawValue));
  } catch {
    throw new Error('Paste a valid Figma prototype link, embed code, or published Figma Make URL.');
  }

  if (FIGMA_SITE_HOST_RE.test(url.hostname)) {
    return [url.toString()];
  }

  if (!FIGMA_HOST_RE.test(url.hostname) && url.hostname !== 'embed.figma.com') {
    throw new Error('The URL must be from figma.com or a published *.figma.site Make app.');
  }

  if (url.hostname === 'www.figma.com' && url.pathname === '/embed') {
    const embedded = url.searchParams.get('url') ?? url.searchParams.get('src');
    if (!embedded) {
      throw new Error('This embed URL is missing its prototype URL.');
    }
    const shareUrl = normalizeShareUrl(new URL(embedded));
    url.searchParams.set('embed_host', EMBED_HOST);
    return uniqueUrls([toDirectEmbedUrl(shareUrl), url.toString(), toWrapperEmbedUrl(shareUrl)]);
  }

  if (url.hostname === 'embed.figma.com') {
    const shareUrl = normalizeShareUrl(url);
    url.searchParams.set('embed-host', EMBED_HOST);
    if (!url.searchParams.has('hide-ui')) {
      url.searchParams.set('hide-ui', '1');
    }
    return uniqueUrls([url.toString(), toWrapperEmbedUrl(shareUrl)]);
  }

  const shareUrl = normalizeShareUrl(url);
  return uniqueUrls([toDirectEmbedUrl(shareUrl), toWrapperEmbedUrl(shareUrl)]);
}

export function toFigmaEmbedUrl(rawValue) {
  return toFigmaEmbedUrls(rawValue)[0];
}

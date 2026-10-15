import JSZip from 'jszip';
import { W_NS, XML_HEAD } from './constants.js';

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const runXml = (r) => {
  const props = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.sz ? `<w:sz w:val="${r.sz}"/>` : '');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(r.t)}</w:t></w:r>`;
};

const paragraphXml = (spec) => {
  const p = typeof spec === 'string' ? { runs: [{ t: spec }] } : spec;
  const props = `<w:pPr><w:spacing w:after="${p.after ?? 140}"/>${p.align ? `<w:jc w:val="${p.align}"/>` : ''}</w:pPr>`;
  return `<w:p>${props}${p.runs.map(runXml).join('')}</w:p>`;
};

export function buildDocx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/styles.xml', `${XML_HEAD}<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="es-CO"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
  zip.file('word/document.xml', `${XML_HEAD}<w:document xmlns:w="${W_NS}"><w:body>${paragraphs.map(paragraphXml).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

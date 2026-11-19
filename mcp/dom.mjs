// El lector de Word del modelo usa DOMParser y XMLSerializer del navegador; en Node los da @xmldom/xmldom.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

globalThis.DOMParser ??= DOMParser;
globalThis.XMLSerializer ??= XMLSerializer;

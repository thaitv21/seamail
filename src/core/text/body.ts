import { convert } from 'html-to-text';

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  });
}

/** The readable body: the text part when it has content, else the HTML part as text. */
export function chooseBodyText(text: string | null | undefined, html: string | null | undefined): string {
  const plain = text?.trim() ? text : html ? htmlToPlainText(html) : '';
  return plain.replace(/\r\n?/g, '\n').trim().normalize('NFC');
}

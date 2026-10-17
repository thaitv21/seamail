import { describe, expect, it } from 'vitest';
import { stripQuotes } from '../../src/core/text/quotes.js';

describe('stripQuotes', () => {
  it('cuts at a one-line "On … wrote:"', () => {
    expect(stripQuotes('Ok, đồng ý.\n\nOn Mon, 13 Oct 2026 at 10:00, Anh A <a@x.test> wrote:\n> Gửi anh báo giá.')).toBe('Ok, đồng ý.');
  });

  it('cuts at a wrapped "On …\\nwrote:"', () => {
    expect(stripQuotes('Ok\n\nOn Mon, 13 Oct 2026 at 10:00 Anh A <a@x.test>\nwrote:\n> old')).toBe('Ok');
  });

  it('cuts at the Vietnamese Gmail header', () => {
    expect(stripQuotes('Dạ vâng.\n\nVào Th 2, 13 thg 10, 2026 vào lúc 10:00 Anh A <a@x.test> đã viết:\n> cũ')).toBe('Dạ vâng.');
  });

  it('cuts at an Outlook separator and header block', () => {
    const body = 'Thanks\n\n________________________________\nFrom: Anh A <a@x.test>\nSent: Monday, October 13, 2026 10:00 AM\nTo: Me\nSubject: Báo giá\n\nold body';
    expect(stripQuotes(body)).toBe('Thanks');
  });

  it('cuts at a Vietnamese Outlook header without separator', () => {
    expect(stripQuotes('Cảm ơn\n\nTừ: Anh A <a@x.test>\nĐã gửi: Thứ Hai, 13 tháng 10, 2026 10:00\nĐến: Me\n\nold')).toBe('Cảm ơn');
  });

  it('cuts at -----Original Message-----', () => {
    expect(stripQuotes('See below\n-----Original Message-----\nFrom: x')).toBe('See below');
  });

  it('removes inline > lines but keeps the answers between them', () => {
    expect(stripQuotes('Answer 1\n> question 2\nAnswer 2')).toBe('Answer 1\nAnswer 2');
  });

  it('keeps a body that is entirely quoted', () => {
    expect(stripQuotes('> only quoted')).toBe('> only quoted');
  });

  it('does not treat a normal "From:" sentence as a header', () => {
    const body = 'From: the team, we wish you well.\nBest';
    expect(stripQuotes(body)).toBe(body);
  });
});

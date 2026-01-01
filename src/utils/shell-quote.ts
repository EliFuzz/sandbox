type ControlOperator =
  | '||'
  | '&&'
  | ';;'
  | '|&'
  | '<('
  | '>>'
  | '>&'
  | '&'
  | ';'
  | '('
  | ')'
  | '|'
  | '<'
  | '>';

const quoteEmpty = (): string => '\'\'';
const quoteOperator = (op: ControlOperator): string =>
  op.replaceAll(/(.)/g, String.raw`\$1`);
const quoteSingle = (s: string): string =>
  '\'' + s.replaceAll(/(')/g, String.raw`\$1`) + '\'';
const quoteDouble = (s: string): string =>
  '"' + s.replaceAll(/(["\\$`!])/g, String.raw`\$1`) + '"';
const quoteDefault = (s: string): string =>
  s.replaceAll(
    /([A-Za-z]:)?([#!"$&'()*,:;<=>?@[\\\]^`{|}])/g,
    String.raw`$1\$2`
  );

const quoteArg = (s: string | { op: ControlOperator }): string => {
  if (s === '') return quoteEmpty();
  if (typeof s === 'object' && s !== null) return quoteOperator(s.op);
  if (/["\s\\]/.test(s) && !/'/.test(s)) return quoteSingle(s);
  if (/["'\s]/.test(s)) return quoteDouble(s);
  return quoteDefault(s);
};

export const shellquote = (
  args: readonly (string | { op: ControlOperator })[]
): string => {
  return args.map(quoteArg).join(' ');
};

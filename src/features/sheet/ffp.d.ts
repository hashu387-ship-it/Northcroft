// Types for fast-formula-parser (the package ships none). Only what the spreadsheet tool uses.
declare module "fast-formula-parser" {
  export interface CellRef {
    sheet?: string;
    row: number;
    col: number;
  }
  export interface RangeRef {
    sheet?: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }
  export interface Position {
    sheet: string;
    row: number;
    col: number;
  }
  export class FormulaError extends Error {
    constructor(error: string, msg?: string);
    readonly error: string;
    static DIV0: FormulaError;
    static NA: FormulaError;
    static NAME: FormulaError;
    static NULL: FormulaError;
    static NUM: FormulaError;
    static REF: FormulaError;
    static VALUE: FormulaError;
  }
  export class DepParser {
    constructor(config?: { onVariable?: (name: string, sheet: string) => CellRef | RangeRef | null });
    parse(formula: string, position: Position): Array<CellRef | RangeRef>;
  }
  export interface Config {
    functions?: Record<string, (...args: never[]) => unknown>;
    onCell?: (ref: CellRef & { sheet: string }) => unknown;
    onRange?: (ref: RangeRef & { sheet: string }) => unknown[][];
    onVariable?: (name: string, sheet: string, position: Position) => CellRef | RangeRef | null;
  }
  export default class FormulaParser {
    constructor(config?: Config);
    parse(formula: string, position: Position, allowReturnArray?: boolean): unknown;
    funsPreserveRef: string[];
    static DepParser: typeof DepParser;
    static FormulaError: typeof FormulaError;
    static Criteria: { parse(criteria: unknown): { op: string; value: unknown; match?: boolean } };
  }
}

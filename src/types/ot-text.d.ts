declare module "ot-text" {
  interface OtTextType {
    name: string;
    uri: string;
    create(initial?: string): string;
    apply(snapshot: string, op: any[]): string;
    transform(op1: any[], op2: any[], side: "left" | "right"): any[];
    compose(op1: any[], op2: any[]): any[];
    normalize(op: any[]): any[];
    transformSelection(selection: any, op: any[], isOwnOp: boolean): any;
    selectionEq(c1: any, c2: any): boolean;
  }

  export const type: OtTextType;
}

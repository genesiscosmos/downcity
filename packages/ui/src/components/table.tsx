/** Vibecape 风格 Table 组件组。 */
import type * as React from "react";
import { cn } from "../lib/utils";
const Table = ({ className, ...props }: React.ComponentProps<"table">) => <div className="w-full overflow-x-auto"><table className={cn("w-full caption-bottom text-sm", className)} {...props} /></div>;
const TableHeader = ({ className, ...props }: React.ComponentProps<"thead">) => <thead className={cn("border-b border-divider text-muted-foreground", className)} {...props} />;
const TableBody = ({ className, ...props }: React.ComponentProps<"tbody">) => <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
const TableFooter = ({ className, ...props }: React.ComponentProps<"tfoot">) => <tfoot className={cn("border-t border-divider bg-surface-subtle font-medium", className)} {...props} />;
const TableRow = ({ className, ...props }: React.ComponentProps<"tr">) => <tr className={cn("border-b border-divider transition-colors hover:bg-interaction-hover data-[state=selected]:bg-interaction-selected", className)} {...props} />;
const TableHead = ({ className, ...props }: React.ComponentProps<"th">) => <th className={cn("h-9 px-2 text-left align-middle text-xs font-medium", className)} {...props} />;
const TableCell = ({ className, ...props }: React.ComponentProps<"td">) => <td className={cn("p-2 align-middle text-sm", className)} {...props} />;
const TableCaption = ({ className, ...props }: React.ComponentProps<"caption">) => <caption className={cn("mt-3 text-xs text-muted-foreground", className)} {...props} />;
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };

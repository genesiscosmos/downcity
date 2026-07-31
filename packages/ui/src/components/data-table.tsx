/** Downcity DataTable 受控数据表格组件。 */
import { cn } from "../lib/utils";
import type { DowncityDataTableProps } from "../types/components";

function DataTable<Row>({ data, columns, getRowId, empty = "No data available.", onRowClick, className }: DowncityDataTableProps<Row>) {
  return <div className="w-full overflow-x-auto"><table className={cn("w-full caption-bottom text-sm", className)}><thead className="border-b border-divider text-muted-foreground"><tr>{columns.map((column) => <th key={column.id} className={cn("h-9 px-2 text-xs font-medium", column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left", column.className)}>{column.header}</th>)}</tr></thead><tbody>{data.length === 0 ? <tr><td colSpan={columns.length} className="px-2 py-8 text-center text-sm text-muted-foreground">{empty}</td></tr> : data.map((row, index) => <tr key={getRowId(row, index)} onClick={() => onRowClick?.(row)} className={cn("border-b border-divider transition-colors", onRowClick && "cursor-pointer hover:bg-interaction-hover")}>{columns.map((column) => <td key={column.id} className={cn("p-2 align-middle", column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left", column.className)}>{column.cell(row)}</td>)}</tr>)}</tbody></table></div>;
}

export { DataTable };

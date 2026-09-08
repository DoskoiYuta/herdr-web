// `table` Block: plain read-only table via the shared ui/table
// primitives (same ones used elsewhere in the app), not a bespoke grid.
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function TableBlock({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className="w-full max-w-full overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            {header.map((h, i) => (
              <TableHead key={i} className="h-8 text-xs">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell key={j} className="text-xs">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

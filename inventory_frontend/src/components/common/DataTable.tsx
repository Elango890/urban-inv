import { ReactNode, useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight, Filter } from "lucide-react";

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (item: T) => ReactNode;
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (item: T) => void;
  filterOptions?: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
  }[];
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function DataTable<T extends { id: string | number }>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Search...",
  pageSize = 10,
  onRowClick,
  filterOptions,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [searchUnlocked, setSearchUnlocked] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const searchInputId = "data-table-search";
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!searchable) return;

    const clearAutofill = () => {
      setSearch("");
      const input = searchInputRef.current;
      if (input && input.value) {
        input.value = "";
      }
    };

    clearAutofill();
    const timers = [0, 150, 500].map((delay) =>
      window.setTimeout(clearAutofill, delay),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [searchable]);

  useEffect(() => {
    setRowsPerPage(pageSize);
  }, [pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filters, rowsPerPage]);

  // Filter data
  let filteredData = data || [];

  if (search) {
    filteredData = filteredData.filter((item) =>
      Object.values(item).some((value) =>
        String(value).toLowerCase().includes(search.toLowerCase()),
      ),
    );
  }

  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "all") {
      filteredData = filteredData.filter(
        (item) => String((item as any)[key]) === value,
      );
    }
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * rowsPerPage;
  const paginatedData = filteredData.slice(startIndex, startIndex + rowsPerPage);

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        {searchable && (
          <div className="relative w-full xl:max-w-md">
            <input
              type="text"
              name="fake-username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
            />
            <input
              type="password"
              name="fake-password"
              autoComplete="current-password"
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
            />
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchInputId}
              name="table-search"
              type="search"
              ref={searchInputRef}
              role="searchbox"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              onFocus={() => setSearchUnlocked(true)}
              readOnly={!searchUnlocked}
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={searchPlaceholder}
              data-form-type="other"
              data-lpignore="true"
              className="pl-10"
            />
          </div>
        )}

        {filterOptions && filterOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            {filterOptions.map((filter) => (
              <Select
                key={filter.key}
                value={filters[filter.key] || "all"}
                onValueChange={(value) => {
                  setFilters((prev) => ({ ...prev, [filter.key]: value }));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-full min-w-[150px] sm:w-[160px]">
                  <SelectValue placeholder={filter.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All {filter.label}</SelectItem>
                  {filter.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {columns.map((column) => (
                <TableHead
                  key={String(column.key)}
                  className={`font-semibold ${column.headerClassName || ""}`}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results found.
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((item) => (
                <TableRow
                  key={item.id}
                  className={onRowClick ? "cursor-pointer" : ""}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={String(column.key)}
                      className={column.cellClassName}
                    >
                      {column.render
                        ? column.render(item)
                        : String((item as any)[column.key] || "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {startIndex + 1} to{" "}
            {Math.min(startIndex + rowsPerPage, filteredData.length)} of{" "}
            {filteredData.length} results
          </p>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safeCurrentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">
              Page {safeCurrentPage} of {totalPages}
            </span>
            <div className="flex items-center gap-2 ml-0 lg:ml-2">
              <span className="text-sm text-muted-foreground">Rows</span>
              <Select
                value={String(rowsPerPage)}
                onValueChange={(value) => setRowsPerPage(Number(value))}
              >
                <SelectTrigger className="h-9 w-[110px] rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safeCurrentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

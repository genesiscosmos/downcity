/** Vibecape 风格 Pagination 组件组。 */
import type * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "../lib/utils";
const Pagination = ({ className, ...props }: React.ComponentProps<"nav">) => <nav aria-label="pagination" className={cn("flex justify-center", className)} {...props} />;
const PaginationContent = ({ className, ...props }: React.ComponentProps<"ul">) => <ul className={cn("flex list-none items-center gap-1 p-0", className)} {...props} />;
const PaginationItem = ({ className, ...props }: React.ComponentProps<"li">) => <li className={cn("list-none", className)} {...props} />;
const PaginationLink = ({ className, isActive = false, ...props }: React.ComponentProps<"a"> & { isActive?: boolean }) => <a aria-current={isActive ? "page" : undefined} className={cn("inline-flex size-6 items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-interaction-hover hover:text-foreground aria-[current=page]:bg-interaction-selected aria-[current=page]:text-foreground", className)} {...props} />;
const PaginationPrevious = (props: React.ComponentProps<typeof PaginationLink>) => <PaginationLink aria-label="Previous page" {...props}><ChevronLeftIcon className="size-3.5" /></PaginationLink>;
const PaginationNext = (props: React.ComponentProps<typeof PaginationLink>) => <PaginationLink aria-label="Next page" {...props}><ChevronRightIcon className="size-3.5" /></PaginationLink>;
const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<"span">) => <span aria-hidden="true" className={cn("inline-flex size-6 items-center justify-center text-xs text-muted-foreground", className)} {...props}>…</span>;
export { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious };

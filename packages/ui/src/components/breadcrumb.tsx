/** Vibecape 风格 Breadcrumb 组件组。 */
import type * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "../lib/utils";
const Breadcrumb = ({ className, ...props }: React.ComponentProps<"nav">) => <nav aria-label="breadcrumb" className={cn("text-xs text-muted-foreground", className)} {...props} />;
const BreadcrumbList = ({ className, ...props }: React.ComponentProps<"ol">) => <ol className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />;
const BreadcrumbItem = ({ className, ...props }: React.ComponentProps<"li">) => <li className={cn("inline-flex items-center gap-1.5", className)} {...props} />;
const BreadcrumbLink = ({ className, ...props }: React.ComponentProps<"a">) => <a className={cn("transition-colors hover:text-foreground", className)} {...props} />;
const BreadcrumbPage = ({ className, ...props }: React.ComponentProps<"span">) => <span aria-current="page" className={cn("text-foreground", className)} {...props} />;
const BreadcrumbSeparator = ({ className, children, ...props }: React.ComponentProps<"li">) => <li role="presentation" className={cn("text-muted-foreground/60", className)} {...props}>{children ?? <ChevronRightIcon className="size-3" />}</li>;
export { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator };

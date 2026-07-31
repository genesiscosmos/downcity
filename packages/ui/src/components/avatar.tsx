"use client";
/** Vibecape 风格 Avatar 组件组。 */
import { Avatar as Primitive } from "@base-ui/react/avatar";
import { cn } from "../lib/utils";
const Avatar = ({ className, ...props }: Primitive.Root.Props) => <Primitive.Root className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full bg-muted text-xs text-muted-foreground", className)} {...props} />;
const AvatarImage = ({ className, ...props }: Primitive.Image.Props) => <Primitive.Image className={cn("size-full object-cover", className)} {...props} />;
const AvatarFallback = ({ className, ...props }: Primitive.Fallback.Props) => <Primitive.Fallback className={cn("flex size-full items-center justify-center", className)} {...props} />;
export { Avatar, AvatarFallback, AvatarImage };

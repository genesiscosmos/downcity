"use client";
/** Vibecape 风格 Progress 组件组。 */
import { Progress as Primitive } from "@base-ui/react/progress";
import { cn } from "../lib/utils";
const Progress = Primitive.Root;
const ProgressTrack = ({ className, ...props }: Primitive.Track.Props) => <Primitive.Track className={cn("h-2.5 w-full overflow-hidden rounded-full bg-muted-foreground/15", className)} {...props} />;
const ProgressIndicator = ({ className, ...props }: Primitive.Indicator.Props) => <Primitive.Indicator className={cn("relative h-full overflow-hidden rounded-full bg-foreground/85 transition-[width] after:absolute after:inset-y-0 after:w-1/2 after:bg-linear-to-r after:from-transparent after:via-background/35 after:to-transparent after:animate-[downcity-progress-shimmer_1.6s_ease-in-out_infinite]", className)} {...props} />;
const ProgressLabel = ({ className, ...props }: Primitive.Label.Props) => <Primitive.Label className={cn("text-xs text-muted-foreground", className)} {...props} />;
const ProgressValue = ({ className, ...props }: Primitive.Value.Props) => <Primitive.Value className={cn("text-xs tabular-nums text-muted-foreground", className)} {...props} />;
export { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue };

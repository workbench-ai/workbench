import type { JSXElementConstructor } from "react";

export interface IconComponentProps {
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
  "data-icon"?: string;
}

export type IconComponent = JSXElementConstructor<IconComponentProps>;

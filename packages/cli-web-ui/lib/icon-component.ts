import type { JSXElementConstructor } from "react";

export interface IconComponentProps {
  className?: string;
  "data-icon"?: string;
}

export type IconComponent = JSXElementConstructor<IconComponentProps>;

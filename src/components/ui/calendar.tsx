import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 w-[280px]", className)}
      classNames={{
        months: "flex flex-col space-y-4",
        month: "space-y-3 w-full",
        caption: "flex justify-center pt-1 relative items-center h-9",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 border-yellow-500/40 text-yellow-500",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse",
        head_row: "flex w-full",
        head_cell:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center",
        row: "flex w-full mt-1",
        // Sem bg-accent no td (evita quadradão branco no tema claro)
        cell: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100 hover:bg-yellow-500/15 hover:text-inherit",
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-yellow-500 text-black hover:bg-yellow-600 hover:text-black focus:bg-yellow-500 focus:text-black",
        day_today: "bg-yellow-500/20 text-yellow-500",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-yellow-500/40 aria-selected:text-black aria-selected:opacity-100",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-yellow-500/25 aria-selected:text-white",
        day_hidden: "invisible",
        ...classNames,
        // Merge: overrides do consumidor não apagam layout das colunas
        head_row: cn("flex w-full", classNames?.head_row),
        head_cell: cn(
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center",
          classNames?.head_cell,
        ),
        row: cn("flex w-full mt-1", classNames?.row),
        cell: cn(
          "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20",
          classNames?.cell,
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100 hover:bg-yellow-500/15 hover:text-inherit",
          classNames?.day,
        ),
        day_selected: cn(
          "bg-yellow-500 text-black hover:bg-yellow-600 hover:text-black focus:bg-yellow-500 focus:text-black",
          classNames?.day_selected,
        ),
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };

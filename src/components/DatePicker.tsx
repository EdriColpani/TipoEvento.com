import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { showError } from "@/utils/toast";

interface DatePickerProps {
  date: Date | undefined;
  setDate: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

const formatInputDate = (value: string): string => {
  const cleanValue = value.replace(/\D/g, "");
  let formatted = cleanValue;

  if (cleanValue.length > 2) {
    formatted = cleanValue.substring(0, 2) + "/" + cleanValue.substring(2);
  }
  if (cleanValue.length > 4) {
    formatted = formatted.substring(0, 5) + "/" + cleanValue.substring(4);
  }
  return formatted.substring(0, 10);
};

export function DatePicker({
  date,
  setDate,
  placeholder = "Selecione a data",
  disabled = false,
}: DatePickerProps) {
  const [inputValue, setInputValue] = React.useState(
    date ? format(date, "dd/MM/yyyy") : "",
  );
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (date && format(date, "dd/MM/yyyy") !== inputValue) {
      setInputValue(format(date, "dd/MM/yyyy"));
    } else if (!date && inputValue !== "") {
      setInputValue("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when `date` prop changes
  }, [date]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formattedDate = formatInputDate(e.target.value);
    setInputValue(formattedDate);

    if (formattedDate.length === 10) {
      const parsedDate = parse(formattedDate, "dd/MM/yyyy", new Date());
      if (isValid(parsedDate)) {
        setDate(parsedDate);
      } else {
        setDate(undefined);
        showError("Formato de data inválido. Use DD/MM/YYYY.");
      }
    } else if (formattedDate.length < 10) {
      setDate(undefined);
    }
  };

  const handleDateSelect = (selectedDate: Date | undefined) => {
    setDate(selectedDate);
    if (selectedDate) {
      setInputValue(format(selectedDate, "dd/MM/yyyy"));
      setOpen(false);
    } else {
      setInputValue("");
    }
  };

  return (
    <div className="relative flex w-full items-center gap-2">
      <Input
        type="text"
        placeholder={placeholder}
        value={inputValue}
        onChange={handleInputChange}
        disabled={disabled}
        maxLength={10}
        className={cn(
          "w-full text-left font-normal bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 hover:bg-black/70 pr-10",
          !date && inputValue.length === 10 && "border-red-500",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label="Abrir calendário"
            className={cn(
              "absolute right-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2 p-0",
              "bg-black/60 border border-yellow-500/30 text-yellow-500",
              "hover:bg-yellow-500/10 hover:text-yellow-400",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            "z-[100] w-auto max-w-[min(100vw-1.5rem,320px)] p-0",
            "bg-black border border-yellow-500/30 text-white shadow-xl",
          )}
        >
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            initialFocus
            locale={ptBR}
            defaultMonth={date}
            className="bg-black text-white"
            classNames={{
              caption_label: "text-white",
              head_cell: "text-gray-400",
              day: "text-white hover:bg-yellow-500/10 hover:text-white",
              day_selected:
                "bg-yellow-500 text-black hover:bg-yellow-600 hover:text-black focus:bg-yellow-500 focus:text-black",
              day_today: "bg-yellow-500/20 text-yellow-400",
              day_outside: "text-gray-500 opacity-60",
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

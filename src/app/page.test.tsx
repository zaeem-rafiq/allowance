import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("asks the visitor the question", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", {
        name: "Can you trick my AI into spending your money?",
      }),
    ).toBeInTheDocument();
  });
});

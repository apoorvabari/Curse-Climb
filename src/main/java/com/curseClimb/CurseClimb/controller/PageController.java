package com.curseClimb.CurseClimb.controller;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.ArrayList;
import java.util.List;

@Controller
public class PageController {

    @GetMapping("/")
    public String index(Model model) {
        // Generate the 10x10 board structure server-side for Thymeleaf
        List<List<Integer>> boardRows = new ArrayList<>();
        
        for (int row = 9; row >= 0; row--) {
            List<Integer> rowCells = new ArrayList<>();
            boolean isLeftToRight = (row % 2 == 0);
            for (int col = 0; col < 10; col++) {
                int actualCol = isLeftToRight ? col : (9 - col);
                int num = row * 10 + actualCol + 1;
                rowCells.add(num);
            }
            boardRows.add(rowCells);
        }
        
        model.addAttribute("boardRows", boardRows);
        return "game";
    }
}

package com.curseClimb.CurseClimb.controller;

import com.curseClimb.CurseClimb.model.GameState;
import com.curseClimb.CurseClimb.service.GameService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * StateController — allows the frontend to fetch the current game state 
 * via standard REST (useful for page refreshes).
 */
@RestController
@RequestMapping("/api")
public class StateController {

    private final GameService gameService;

    @Autowired
    public StateController(GameService gameService) {
        this.gameService = gameService;
    }

    @GetMapping("/state/{gameId}")
    public GameState getGameState(@PathVariable String gameId) {
        return gameService.getGameState(gameId);
    }
}

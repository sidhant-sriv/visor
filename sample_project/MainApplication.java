// MainApplication.java
package com.example.main;

import com.example.service.UserService;
import java.util.List;

public class MainApplication {
    private UserService userService;
    
    public MainApplication() {
        this.userService = new UserService();
        initializeData();
    }
    
    private void initializeData() {
        userService.addUser("john_doe");
        userService.addUser("jane_smith");
        userService.addUser("admin");
    }
    
    public void run() {
        System.out.println("Application started");
        
        List<String> users = userService.getAllUsers();
        System.out.println("Total users: " + userService.getUserCount());
        
        for (String user : users) {
            System.out.println("User: " + user);
        }
        
        boolean hasAdmin = userService.hasUser("admin");
        System.out.println("Has admin: " + hasAdmin);
    }
    
    public static void main(String[] args) {
        MainApplication app = new MainApplication();
        app.run();
    }
}
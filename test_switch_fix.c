#include <stdio.h>
#include <stdlib.h>

void introduce_error(char *data, int length, int error_type)
{
    switch (error_type)
    {
    case 1:
    {
        int pos = rand() % length;
        data[pos] = (data[pos] == '0') ? '1' : '0';
    }
    break;
    case 2:
    {
        int num_errors = 2 + rand() % 3;
        for (int i = 0; i < num_errors; i++)
        {
            int pos = rand() % length;
            data[pos] = (data[pos] == '0') ? '1' : '0';
        }
    }
    break;
    case 3:
    {
        int burst_length = 3 + rand() % 3;
        int start_pos = rand() % (length - burst_length);
        for (int i = 0; i < burst_length; i++)
        {
            data[start_pos + i] = (data[start_pos + i] == '0') ? '1' : '0';
        }
    }
    break;
    }
}

// Additional test function with more complex switch patterns
void test_complex_switch(int value)
{
    switch (value)
    {
    case 1:
        printf("Case 1: Simple statement\n");
        break;

    case 2:
    {
        int temp = value * 2;
        printf("Case 2: Block with temp = %d\n", temp);

        if (temp > 5)
        {
            printf("Temp is greater than 5\n");
        }
    }
    break;

    case 3:
    case 4:
    {
        // Fall-through cases
        printf("Cases 3 or 4\n");
        int result = value + 10;

        while (result > 0)
        {
            printf("Result: %d\n", result);
            result--;
            if (result < 10)
                break;
        }
    }
    break;

    default:
    {
        printf("Default case\n");

        switch (value)
        {
        case 100:
            printf("Nested switch case 100\n");
            break;
        default:
            printf("Nested switch default\n");
            break;
        }
    }
    break;
    }
}

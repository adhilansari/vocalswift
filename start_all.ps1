# Start Redis in Docker
Write-Host "Starting Redis..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "docker run -d -p 6379:6379 redis"
Start-Sleep -Seconds 3
# Start Python Separation Service
Write-Host "Starting Python Service..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd separation-service; .\venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"

# Start NestJS Backend
Write-Host "Starting NestJS Backend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; npm run start:dev"

# Start NextJS Frontend
Write-Host "Starting NextJS Frontend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

Write-Host "All applications are starting! Please wait a moment for them to boot up, then visit http://localhost:3000 in your browser."


// Requests the URL in the first argument. The runner expects the trap proxy to refuse it.
let client = new System.Net.Http.HttpClient()
client.GetAsync(fsi.CommandLineArgs.[1]).Result |> ignore

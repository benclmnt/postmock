// Calls the Postmark client the suite builds, with the base URL in the second argument. The
// runner expects the trap proxy to refuse the request. The client loads in its own context, next to
// its own System.Text.Json, which differs from the one fsi loads.
open System.IO
open System.Runtime.Loader

let dll = fsi.CommandLineArgs.[1]

type SuiteContext() =
    inherit AssemblyLoadContext("postmock-probe")
    override this.Load(name) =
        let path = Path.Combine(Path.GetDirectoryName(dll), name.Name + ".dll")
        if File.Exists(path) then this.LoadFromAssemblyPath(path) else null

let assembly = SuiteContext().LoadFromAssemblyPath(dll)
let clientType = assembly.GetType("PostmarkDotNet.PostmarkClient")
let client = System.Activator.CreateInstance(clientType, [| box "postmock-server-token"; box fsi.CommandLineArgs.[2] |])
(clientType.GetMethod("GetServerAsync").Invoke(client, [||]) :?> System.Threading.Tasks.Task).Wait()

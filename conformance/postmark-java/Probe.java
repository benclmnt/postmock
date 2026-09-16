// Opens the URL in args[0]. On the sandbox network the runner expects "Network is unreachable".
public class Probe {
    public static void main(String[] args) throws Exception {
        new java.net.URL(args[0]).openStream().close();
    }
}

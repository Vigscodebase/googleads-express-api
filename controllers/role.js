import role from "../models/role.js"

export const fetchrole = async (req, res) => {
    try {
        let list_roles = [];
        list_roles = await role.find({})

        if (list_roles.length == 0) {
            return res.status(204).json({
                message: "Roles doesn't exist on database please do add roles."
            })
        }

        if (list_roles) {
            return res.status(200).json({
                data: list_roles,
                message: "All roles fetched successfully"
            })
        }
        else {
            return res.status(400).json({
                message: 'Something went wrong!'
            })
        }

    } catch (error) {
        console.log(error)
        res.status(500).json({
            message: error.message
        })
    }
}